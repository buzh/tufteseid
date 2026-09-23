// The cached ground: RVT's combined VAT, precomputed per LiDAR acquisition into
// one MBTiles database each by `vat-cache/makevat.py` and served by the
// `cvat-tiles` sidecar.

import { extend } from 'ol/extent';
import { transformExtent } from 'ol/proj';
import { halved } from '../../../compare/halves';
import { getWMSTileGrid } from '../../wmsTileGrid';
import {
  CVAT_STYLE,
  fetchLidarProjects,
  parsePointDensity,
  parseYear,
  type LidarProject,
} from './lidarProjects';
import { XYZBackgroundLayer } from './types';

// A manifest acquisition name is byte-identical to the `LidarProject.id` the
// per-project WMS publishes, so the two join with no name mapping.
export type CvatAcquisition = {
  project: LidarProject;
  // This acquisition's namespace in the store: one database on the server, one
  // path segment here. Overlapping flights cannot share a `<z>/<x>/<y>`.
  path: string;
  // Levels written, absolute z on the app's own grid (`wmsTileGrid.ts`): z16 is
  // 0.331 m/px, z12 5.289 m/px. Depth follows the DTM — z16 at 0.25 m, z15 at
  // 0.5 m — and a half-built acquisition is a normal state of the store.
  minZoom: number;
  maxZoom: number;
  // The store's own envelope in EPSG:25833, off the manifest's tile indices;
  // null against a sidecar too old to publish one.
  extent25833: [number, number, number, number] | null;
};

// Written in lockstep with `activeLidarProjectHalves`. Null until Automatisk
// has named a flight.
export const activeCvatAcquisitionHalves = halved<CvatAcquisition | null>(null);

const CVAT_MANIFEST_URL = '/cvat/manifest.json';

const cvatTileUrl = (path: string) => `/cvat/${path}/{z}/{x}/{y}.webp`;

// Inclusive tile indices on the app's own grid (`wmsTileGrid.ts`) at the
// coarsest level held; an envelope, not a footprint. `cvat-tiles/server.mjs`
// flips MBTiles' south-up row count to the app's, so `y0` is the northern edge.
export type CvatBounds = {
  z: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

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
    if (typeof path !== 'string' || path === '') {
      console.warn(`[cvat] ${name} has no path in the manifest`);
      continue;
    }
    if (zs.length > 0) {
      store[name] = { levels: zs, path, bounds: parseBounds(bounds) };
    }
  }
  return store;
};

// One fetch per page load: the store only grows by a file landing on the
// server, which a reload picks up.
let storePromise: Promise<CvatStore> | null = null;

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

// A catalogue row synthesized from the store, for when the catalogue is down or
// has dropped the flight. No WMS styles: only the service knows those.
const placeFromStore = (
  id: string,
  extent25833: [number, number, number, number] | null,
): LidarProject | null => {
  if (!extent25833) return null;
  // 8 stops per edge: the box bows under the transform.
  const lonLat = transformExtent(extent25833, 'EPSG:25833', 'EPSG:4326', 8);
  return {
    id,
    projectName: id,
    year: parseYear(id),
    pointDensity: parsePointDensity(id),
    bboxLonLat: [lonLat[0], lonLat[1], lonLat[2], lonLat[3]],
    styles: [],
  };
};

// The join runs on every footprint refresh, so warn once per acquisition.
const warned = new Set<string>();

// The catalogue wins where it has a row, since it carries the flight's WMS
// styles; the manifest's envelope places the rest.
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

// Not memoised, so a list built during a catalogue outage picks the catalogue
// back up afterwards.
export const fetchCvatAcquisitions = async (): Promise<CvatAcquisition[]> => {
  const [store, projects] = await Promise.all([
    fetchCvatStore(),
    fetchLidarProjects().catch(() => [] as LidarProject[]),
  ]);
  return resolveCvatAcquisitions(store, projects);
};

export const cvatFor = (
  cached: CvatAcquisition[],
  project: LidarProject | null,
): CvatAcquisition | null =>
  (project && cached.find((a) => a.project.id === project.id)) || null;

export const stylesForFlight = (
  project: LidarProject,
  cached: CvatAcquisition | null,
): string[] => (cached ? [CVAT_STYLE, ...project.styles] : project.styles);

export const buildCvatGroundConfig = (
  acquisition: CvatAcquisition,
): XYZBackgroundLayer => ({
  type: 'XYZ',
  layerName: 'lidarCvat',
  url: cvatTileUrl(acquisition.path),
  projection: 'EPSG:25833',
  minZoom: acquisition.minZoom,
  maxZoom: acquisition.maxZoom,
  // A miss is a SELECT against a bind-mounted database, so preloading is free.
  preload: 2,
  // Unwritten tiles inside the extent answer 404; that transparency is the
  // coverage mask.
  sparse: true,
  // The store stops at z15 or z16 and the view goes to z20 (`types.ts`).
  interpolate: false,
  coverageExtent: acquisition.extent25833
    ? { extent: acquisition.extent25833, crs: 'EPSG:25833' }
    : { extent: acquisition.project.bboxLonLat, crs: 'EPSG:4326' },
});

// The provenance plate the render menu shows. Transcribed from
// `vat-cache/cvat.py` rather than read off the manifest: a downloaded figure
// travels off this host.
export const CVAT_RENDERER = 'RVT';
export const CVAT_TEMPLATE = 'VAT_Combined';

// RVT's `max_rad`, in RVT's own pixels and the same at every level, so the
// visualization's reach in metres grows as you zoom out.
export const CVAT_RADIUS_PX = { general: 10, flat: 20 } as const;
