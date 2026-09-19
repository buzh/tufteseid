// The cached ground: RVT's combined VAT — hillshade, slope, positive openness
// and sky-view in one picture — precomputed over whole LiDAR acquisitions and
// written to disk as plain tiles. `vat-cache/vatcache.py` made them and
// `/cvat/manifest.json` beside them states the presets, the blend order, the
// radii per level, the digest of the run and — the part this module reads at
// runtime — which acquisitions are in the store and at which levels.
//
// Not a service: Caddy's own `file_server` serves the bind-mounted store, so
// there is no proxy route, no wmscache entry and no CSP host — `img-src 'self'`
// already covers it, and `connect-src 'self'` the manifest.

import { halved } from '../../../compare/halves';
import type { VatStackLayer } from '../../../../terrain/shade';
import type { LidarProject } from './lidarProjects';
import { XYZBackgroundLayer } from './types';

/**
 * One acquisition in the store: the catalogue row the tiles were computed from,
 * and the levels that were written for it.
 *
 * The catalogue row rather than a name, because the acquisition in the manifest
 * is byte-identical to the `LidarProject.id` the per-project WMS publishes —
 * which is what lets the footprint ranking the app already has say where the
 * cache reaches, with no name mapping and no second coverage source. It also
 * carries the envelope for the layer's extent and is what `Behold` stitches.
 */
export type CvatAcquisition = {
  project: LidarProject;
  /** This acquisition's own directory in the store, as the manifest states it.
   *  Two flights over one landscape are two pictures of it and the app offers
   *  both, so their tiles cannot share a `<z>/<x>/<y>`. */
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
};

/** Which cached acquisition is drawing. Null until one is picked, so a cold
 *  load into `?backgroundLayer=lidarCvat` draws nothing until the footprint
 *  ranking says which acquisition the view is over — a tick, and then the
 *  ground the link was shared on. */
export const activeCvatAcquisitionHalves = halved<CvatAcquisition | null>(null);
export const activeCvatAcquisitionAtom = activeCvatAcquisitionHalves.focused;

// ---------------------------------------------------------------------------
// What is in the store, asked at runtime
// ---------------------------------------------------------------------------

const CVAT_MANIFEST_URL = '/cvat/manifest.json';

/** The tile template, given the acquisition's own directory. Each acquisition
 *  has one, because a tile carries no provenance and overlapping flights are
 *  the point rather than an accident to curate away. */
const cvatTileUrl = (path: string) => `/cvat/${path}/{z}/{x}/{y}.webp`;

/** What `build_tiles.py` writes under `acquisitions`: acquisition name to the
 *  levels built for it and the directory they are in. */
export type CvatStore = Record<string, { levels: number[]; path: string }>;

const parseStore = (body: unknown): CvatStore => {
  if (!body || typeof body !== 'object') return {};
  const block = (body as Record<string, unknown>).acquisitions;
  if (!block || typeof block !== 'object') return {};
  const store: CvatStore = {};
  for (const [name, entry] of Object.entries(block)) {
    const { levels, path } = (entry ?? {}) as { levels?: unknown; path?: unknown };
    if (!Array.isArray(levels)) continue;
    const zs = levels.filter((z): z is number => Number.isInteger(z));
    // No path means a manifest written before the store was divided per
    // acquisition. Guessing the slug rule here would be a second copy of it;
    // any `vatcache.py` run rewrites the entry with its own.
    if (typeof path !== 'string' || path === '') {
      console.warn(`[cvat] ${name} has no path in the manifest`);
      continue;
    }
    if (zs.length > 0) store[name] = { levels: zs, path };
  }
  return store;
};

// One fetch per page load, shared by every caller. The store grows by a batch
// run on the server, not by anything the tab does, so re-reading it mid-session
// would only cost a request; a reload picks up whatever has landed since.
let storePromise: Promise<CvatStore> | null = null;

/**
 * What the store holds. An install without one answers 404 — `file_server` has
 * no SPA fallback to turn that into an index page — and an empty store is the
 * honest answer: no cached rows anywhere in the app, rather than a dataset that
 * is offered and draws nothing.
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

/**
 * The store joined to the LiDAR catalogue. An acquisition the catalogue does
 * not publish is dropped with a warning rather than half-wired: without the
 * catalogue row there is no footprint to rank it by and no envelope to cull
 * with, so it could only be offered everywhere and described as nothing.
 */
export const resolveCvatAcquisitions = (
  store: CvatStore,
  projects: LidarProject[],
): CvatAcquisition[] =>
  Object.entries(store).flatMap(([id, { levels, path }]) => {
    const project = projects.find((p) => p.id === id);
    if (!project) {
      console.warn(`[cvat] ${id} is in the store but not in the catalogue`);
      return [];
    }
    return [
      {
        project,
        path,
        minZoom: Math.min(...levels),
        maxZoom: Math.max(...levels),
      },
    ];
  });

/**
 * The layer for one cached acquisition.
 *
 * The extent is the acquisition's own envelope, of which the acquisition itself
 * fills a few per cent. It stops OL asking outside; inside it the tiles nobody
 * wrote answer 404, which OL marks errored and leaves transparent — and that
 * transparency is the coverage mask, with the faded mosaic underneath showing
 * through.
 *
 * Overlap is expected and is the reason each acquisition has its own directory.
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
  coverageExtent: {
    extent: acquisition.project.bboxLonLat,
    crs: 'EPSG:4326',
  },
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
