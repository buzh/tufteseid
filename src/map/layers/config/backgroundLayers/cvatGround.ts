// The cached ground: RVT's combined VAT — hillshade, slope, positive openness
// and sky-view in one picture — precomputed over whole LiDAR acquisitions and
// written to an MBTiles database per acquisition by `vat-cache/makevat.py`.
// Each database states its own presets, blend order, radii and run digest in
// its `metadata` table; `/cvat/manifest.json` is the part this module reads at
// runtime — which acquisitions are in the store, at which levels, and over
// which tiles — and is built by the sidecar out of the files it finds, not
// written beside them.
//
// The envelope in that manifest is what lets the store stand alone. Kartverket
// publishes a catalogue row for every flight, and where one is to be had it is
// the better description — it names the WMS styles the flight can also be drawn
// in. But it comes off the same backend as the national mosaic, so the hour our
// own tiles are the only relief left is the hour that catalogue does not
// answer, and an acquisition placed only by it would go missing exactly then.
//
// Nothing upstream: the `cvat-tiles` sidecar reads the bind-mounted store and
// answers a tile at a time, so there is no wmscache entry and no CSP host —
// `img-src 'self'` already covers it, and `connect-src 'self'` the manifest.
// The URLs below are the ones the store answered when it was a tree of files
// under Caddy's own root; the container changed underneath them and this module
// did not.

import { extend } from 'ol/extent';
import { transformExtent } from 'ol/proj';
import { halved } from '../../../compare/halves';
import type { VatStackLayer } from '../../../../terrain/shade';
import { getWMSTileGrid } from '../../wmsTileGrid';
import {
  CVAT_STYLE,
  fetchLidarProjects,
  parsePointDensity,
  parseYear,
  type LidarProject,
} from './lidarProjects';
import { XYZBackgroundLayer } from './types';

/**
 * One acquisition in the store: a catalogue row for the flight the tiles were
 * computed from, the levels that were written for it, and where they lie.
 *
 * A catalogue row rather than a name, because the acquisition in the manifest
 * is byte-identical to the `LidarProject.id` the per-project WMS publishes —
 * which is what lets the footprint ranking the app already has say where the
 * cache reaches, with no name mapping and no second coverage source. It is also
 * what `Behold` stitches. Where the catalogue has no row for the name, one is
 * made out of the store's own manifest (`placeFromStore`): the same shape, with
 * no WMS styles in it, since those are the one thing only the service knows.
 */
export type CvatAcquisition = {
  project: LidarProject;
  /** This acquisition's own namespace in the store, as the manifest states it —
   *  a database of its own on the server, one path segment here. Two flights
   *  over one landscape are two pictures of it and the app offers both, so
   *  their tiles cannot share a `<z>/<x>/<y>`. */
  path: string;
  /** The coarsest and deepest levels written, on the app's own grid
   *  (`wmsTileGrid.ts`): z16 is 0.331 m/px, z12 5.289 m/px. How deep depends on
   *  the flight — z16 only where hoydedata.no publishes a 0.25 m DTM, z15 where
   *  it publishes 0.5 m, since below the DEM's own cell the picture is of the
   *  interpolation. Radii are RVT's own pixels at every level, so the levels of
   *  one acquisition are related pictures rather than one picture at several
   *  sizes — the reach of the visualization grows as you zoom out. Per
   *  acquisition, because a level built for one is not built for another, and a
   *  half-built acquisition is the normal state of a store that is growing. */
  minZoom: number;
  maxZoom: number;
  /** The store's own envelope in EPSG:25833, from the tile indices the manifest
   *  carries. Tighter than the catalogue's bbox and true of these tiles rather
   *  than of the flight, so it is the better extent to cull with where it is
   *  there. Null against a sidecar too old to publish one. */
  extent25833: [number, number, number, number] | null;
};

/**
 * The cached render of the flight that is selected, or null where the store has
 * no tiles for it. Written in lockstep with `activeLidarProjectHalves` — the
 * flight is the choice and this follows it, so the two can never name different
 * acquisitions.
 *
 * Null at a cold load into `?backgroundLayer=lidarCvat`, which draws nothing
 * until Automatisk has named a flight — a tick, and then the ground the link
 * was shared on.
 */
export const activeCvatAcquisitionHalves = halved<CvatAcquisition | null>(null);

// ---------------------------------------------------------------------------
// What is in the store, asked at runtime
// ---------------------------------------------------------------------------

const CVAT_MANIFEST_URL = '/cvat/manifest.json';

/** The tile template, given the acquisition's own namespace. Each acquisition
 *  has one, because a tile carries no provenance and overlapping flights are
 *  the point rather than an accident to curate away. */
const cvatTileUrl = (path: string) => `/cvat/${path}/{z}/{x}/{y}.webp`;

/** Where an acquisition lies, as inclusive tile indices on the app's own grid
 *  (`wmsTileGrid.ts`) at one level — the coarsest the store holds for it. An
 *  envelope, not a footprint: the holes inside it are the 404s. Read off the
 *  tiles table by `cvat-tiles/server.mjs`, which also flips MBTiles' row count
 *  to the app's, so `y0` is the northern edge. */
export type CvatBounds = {
  z: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/** What the sidecar synthesizes under `acquisitions`: acquisition name to the
 *  levels built for it, the namespace they are in, and their envelope. */
export type CvatStore = Record<
  string,
  { levels: number[]; path: string; bounds: CvatBounds | null }
>;

const parseBounds = (raw: unknown): CvatBounds | null => {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const at = (k: string): number | null =>
    Number.isInteger(b[k]) ? (b[k] as number) : null;
  const z = at('z');
  const x0 = at('x0');
  const y0 = at('y0');
  const x1 = at('x1');
  const y1 = at('y1');
  if (z === null || x0 === null || y0 === null || x1 === null || y1 === null) {
    return null;
  }
  return { z, x0, y0, x1, y1 };
};

const parseStore = (body: unknown): CvatStore => {
  if (!body || typeof body !== 'object') return {};
  const block = (body as Record<string, unknown>).acquisitions;
  if (!block || typeof block !== 'object') return {};
  const store: CvatStore = {};
  for (const [name, entry] of Object.entries(block)) {
    const { levels, path, bounds } = (entry ?? {}) as {
      levels?: unknown;
      path?: unknown;
      bounds?: unknown;
    };
    if (!Array.isArray(levels)) continue;
    const zs = levels.filter((z): z is number => Number.isInteger(z));
    // No path means a manifest from before the store was divided per
    // acquisition. Guessing the slug rule here would be a second copy of it,
    // and the sidecar now takes the path from the database's own filename.
    if (typeof path !== 'string' || path === '') {
      console.warn(`[cvat] ${name} has no path in the manifest`);
      continue;
    }
    // A missing envelope is not fatal: an older sidecar publishes none, and
    // such an acquisition still draws wherever the catalogue can place it.
    if (zs.length > 0) {
      store[name] = { levels: zs, path, bounds: parseBounds(bounds) };
    }
  }
  return store;
};

// One fetch per page load, shared by every caller. The store grows by a file
// landing in a directory on the server, not by anything the tab does, so
// re-reading it mid-session would only cost a request; a reload picks up
// whatever has been copied in since.
let storePromise: Promise<CvatStore> | null = null;

/**
 * What the store holds. An install without one answers an empty `acquisitions`
 * block, which is the honest answer: no cached rows anywhere in the app, rather
 * than a dataset that is offered and draws nothing. The `catch` is for the
 * sidecar being unreachable, and lands in the same place.
 */
export const fetchCvatStore = (): Promise<CvatStore> => {
  storePromise ??= fetch(CVAT_MANIFEST_URL)
    .then((res) => (res.ok ? res.json() : null))
    .then(parseStore)
    .catch((err) => {
      console.warn('[cvat] manifest unavailable', err);
      return {};
    });
  return storePromise;
};

/** The manifest's tile indices as an extent in projected metres. */
const boundsExtent25833 = (
  bounds: CvatBounds,
): [number, number, number, number] | null => {
  const grid = getWMSTileGrid('EPSG:25833');
  if (!grid) return null;
  const { z, x0, y0, x1, y1 } = bounds;
  const e = extend(
    grid.getTileCoordExtent([z, x0, y0]),
    grid.getTileCoordExtent([z, x1, y1]),
  );
  return [e[0], e[1], e[2], e[3]];
};

/**
 * A catalogue row for an acquisition the catalogue has not given us.
 *
 * The name is the id, because the store's names *are* the WMS layer prefixes —
 * that identity is what made the join possible in the first place. Year and
 * point density come out of that name by the same two readers the catalogue's
 * own parser uses, and the envelope out of the store's tile indices.
 *
 * No styles, and that is the honest shape rather than a gap: the flight's WMS
 * renders are precisely what this does not know, and during the outage this
 * exists for they could not be drawn anyway. A flight placed this way offers
 * the cached render and nothing else.
 */
const placeFromStore = (
  id: string,
  extent25833: [number, number, number, number] | null,
): LidarProject | null => {
  if (!extent25833) return null;
  const lonLat = transformExtent(
    extent25833,
    'EPSG:25833',
    'EPSG:4326',
    // The envelope's north and south edges bow under the transform; sampling
    // the sides keeps the lon/lat box around all of it rather than through it.
    8,
  );
  return {
    id,
    projectName: id,
    year: parseYear(id),
    pointDensity: parsePointDensity(id),
    bboxLonLat: [lonLat[0], lonLat[1], lonLat[2], lonLat[3]],
    styles: [],
  };
};

// The join runs on every footprint refresh, and an acquisition the catalogue
// will never name would otherwise say so once a pan.
const warned = new Set<string>();

/**
 * The store, placed. The catalogue wins where it has a row — it carries the
 * flight's WMS styles — and the manifest's own envelope places the rest. Only
 * an acquisition that is in neither, which means an old sidecar and a flight
 * the catalogue has dropped, has nowhere to be put and is left out.
 */
export const resolveCvatAcquisitions = (
  store: CvatStore,
  projects: LidarProject[],
): CvatAcquisition[] =>
  Object.entries(store).flatMap(([id, { levels, path, bounds }]) => {
    const extent25833 = bounds ? boundsExtent25833(bounds) : null;
    const project =
      projects.find((p) => p.id === id) ?? placeFromStore(id, extent25833);
    if (!project) {
      if (!warned.has(id)) {
        warned.add(id);
        console.warn(
          `[cvat] ${id} is in the store, absent from the catalogue and ` +
            'carries no envelope in the manifest; nothing can place it',
        );
      }
      return [];
    }
    return [
      {
        project,
        path,
        minZoom: Math.min(...levels),
        maxZoom: Math.max(...levels),
        extent25833,
      },
    ];
  });

/**
 * The store, placed, as one call.
 *
 * The catalogue is asked for and not depended on: `fetchLidarProjects` answers
 * from its week of localStorage, falls back to a stale copy, and only then
 * throws — and a throw here is an empty list of rows, not an empty list of
 * acquisitions. See the header for why that asymmetry is the whole point.
 *
 * Not memoised, unlike the two fetches behind it. Both answer from a cache or
 * fail at once, the join is a handful of entries, and re-running it is how a
 * list built during an outage picks the catalogue back up afterwards.
 */
export const fetchCvatAcquisitions = async (): Promise<CvatAcquisition[]> => {
  const [store, projects] = await Promise.all([
    fetchCvatStore(),
    fetchLidarProjects().catch(() => [] as LidarProject[]),
  ]);
  return resolveCvatAcquisitions(store, projects);
};

/** The store's render of one flight, or null where it holds none. */
export const cvatFor = (
  cached: CvatAcquisition[],
  project: LidarProject | null,
): CvatAcquisition | null =>
  (project && cached.find((a) => a.project.id === project.id)) || null;

/**
 * The renders offered on one flight: ours first where the store has it, then
 * whatever its WMS publishes. This is the whole of the cache's place in the UI
 * — a row in the style ring, not a dataset beside the flight it came from.
 */
export const stylesForFlight = (
  project: LidarProject,
  cached: CvatAcquisition | null,
): string[] => (cached ? [CVAT_STYLE, ...project.styles] : project.styles);

/**
 * The layer for one cached acquisition.
 *
 * The extent is the store's own envelope where the manifest carries one and the
 * catalogue's bbox otherwise — the store's being the tighter of the two, since
 * it bounds the tiles rather than the flight. Either way the acquisition fills
 * a few per cent of it. It stops OL asking outside; inside it the tiles nobody
 * wrote answer 404, which OL marks errored and leaves transparent — and that
 * transparency is the coverage mask, with the faded mosaic underneath showing
 * through. That is what `sparse` says, and the mask is why: a retry would ask
 * three times for every tile of it and be told the same thing three times.
 *
 * `maxZoom` is the deepest level written *anywhere* in the acquisition, and one
 * flight can be 0.25 m DTM over a town and 0.5 m over the forest behind it — so
 * the deepest level is often the mask's own edge, and a link shared at it opens
 * on the level below drawn large. That is the store being honest about its
 * reach rather than something to cap away.
 *
 * Overlap is expected and is the reason each acquisition has its own namespace.
 * Two flights over one landscape are two readings of it — a 5 pkt from 2021 and
 * a 10 pkt from 2025 are not the same ground twice — so both are offered as
 * rows and each draws only its own tiles.
 */
export const buildCvatGroundConfig = (
  acquisition: CvatAcquisition,
): XYZBackgroundLayer => ({
  type: 'XYZ',
  layerName: 'lidarCvat',
  url: cvatTileUrl(acquisition.path),
  projection: 'EPSG:25833',
  minZoom: acquisition.minZoom,
  maxZoom: acquisition.maxZoom,
  // Nothing upstream to reach through to: a miss is a SELECT against a
  // bind-mounted database, so fetching a level either side of the one on screen
  // costs nothing and takes the blank out of a zoom step.
  preload: 2,
  sparse: true,
  coverageExtent: acquisition.extent25833
    ? { extent: acquisition.extent25833, crs: 'EPSG:25833' }
    : { extent: acquisition.project.bboxLonLat, crs: 'EPSG:4326' },
});

/**
 * The acquisition a screenshot was taken over, for records written before the
 * store held more than one and the figure plate therefore had nothing to record.
 * There was exactly one until then, and this was it.
 */
export const CVAT_LEGACY_ACQUISITION_ID = 'Vestfold og Telemark 5pkt 2021';

// ---------------------------------------------------------------------------
// What the pixels are, for the provenance plate
// ---------------------------------------------------------------------------
//
// A screenshot over this ground is the one figure the app hands out whose
// relief nobody upstream computed: hoydedata.no served height values and RVT,
// run here, made the picture. The plate has to say both, or the file reads as
// Kartverket's own shading.
//
// The manifest beside the tiles is the authority and carries the rest — the
// stretches, the per-level radii in metres, the encoder, the digest of the run.
// What a legend can print is transcribed here rather than fetched from it: a
// downloaded figure travels off this host, and a plate that could only be
// written while the store answered would be missing from exactly the files that
// leave. `vat-cache/cvat.py` is where these numbers come from.
//
// One set of them for the whole store, not one per acquisition: the recipe is
// what has to agree between runs, and a store whose manifest disagrees with the
// run about it refuses to be written into.
//
// Not `VAT_STACK` from `terrain/shade.ts`, which transcribes the same RVT
// template for the client-side render. The two agree today; they describe
// different renderers and must stay free to disagree.

/** The renderer and the template, named the way RVT names them. */
export const CVAT_RENDERER = 'RVT';
export const CVAT_TEMPLATE = 'VAT_Combined';

/**
 * The blend, bottom to top. Opacity is what each layer performs at, not what
 * the template names: `rvt.blend_func.blend_overlay` writes through its
 * background, so the manifest's 50 % on the openness layer behaves as 100 % —
 * RVT's own behaviour, left uncorrected in the cache and recorded here as what
 * it does.
 */
export const CVAT_STACK: readonly VatStackLayer[] = [
  { vis: 'hillshade', blend: 'normal', opacity: 100 },
  { vis: 'slope', blend: 'luminosity', opacity: 50 },
  { vis: 'openPos', blend: 'overlay', opacity: 100 },
  { vis: 'svf', blend: 'multiply', opacity: 25 },
];

/**
 * Degrees. Frozen, like the app's own VAT: a moving sun makes two renders
 * incomparable.
 */
export const CVAT_AZIMUTH = 315;

/** Sun height per preset, degrees. */
export const CVAT_SUN_ALTITUDE = { general: 35, flat: 15 } as const;

/**
 * RVT's `max_rad`, in RVT's own pixels and the same number at every level —
 * which is why the levels are related pictures rather than one picture at
 * several sizes.
 */
export const CVAT_RADIUS_PX = { general: 10, flat: 20 } as const;

/** Percent of the general preset laid over the flat one. */
export const CVAT_GENERAL_OPACITY = 50;
