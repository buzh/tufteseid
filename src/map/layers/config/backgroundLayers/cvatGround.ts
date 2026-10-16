import { buffer, extend } from 'ol/extent';
import type { Geometry } from 'ol/geom';
import { transformExtent } from 'ol/proj';
import { serviceOn } from '../../../../services';
import { halved } from '../../../compare/halves';
import { getWMSTileGrid } from '../../wmsTileGrid';
import { fetchLidarFootprints, touchesExtent } from './lidarFootprints';
import {
  CVAT_STYLE,
  fetchLidarProjects,
  parsePointDensity,
  parseYear,
  type LidarProject,
} from './lidarProjects';
import { XYZBackgroundLayer } from './types';

export type CvatAcquisition = {
  project: LidarProject;
  path: string;
  minZoom: number;
  maxZoom: number;
  extent25833: [number, number, number, number] | null;
};

export const activeCvatAcquisitionHalves = halved<CvatAcquisition | null>(null);

const CVAT_MANIFEST_URL = '/cvat/manifest.json';

const cvatTileUrl = (path: string) => `/cvat/${path}/{z}/{x}/{y}.webp`;

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

let storePromise: Promise<CvatStore> | null = null;

export const fetchCvatStore = (): Promise<CvatStore> => {
  if (!serviceOn('cvat')) return Promise.resolve({});
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

const placeFromStore = (
  id: string,
  extent25833: [number, number, number, number] | null,
): LidarProject | null => {
  if (!extent25833) return null;
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

const warned = new Set<string>();

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

const CVAT_CRS = 'EPSG:25833';

const footprints = new Map<string, Geometry[]>();
const asked = new Set<string>();

const loadFootprint = (project: LidarProject): void => {
  if (asked.has(project.id)) return;
  asked.add(project.id);
  void fetchLidarFootprints([project], CVAT_CRS).then(
    ({ footprints: found, unanswered }) => {
      const geometries = found.get(project.id)?.geometries;
      if (geometries?.length) footprints.set(project.id, geometries);
      else if (unanswered) asked.delete(project.id);
    },
  );
};

const FOOTPRINT_MARGIN_M = 500;

const cvatCoverageMask =
  (project: LidarProject) =>
  (extent: [number, number, number, number]): boolean => {
    loadFootprint(project);
    const geometries = footprints.get(project.id);
    if (!geometries) return true;
    const grown = buffer(extent, FOOTPRINT_MARGIN_M);
    return touchesExtent(geometries, [grown[0], grown[1], grown[2], grown[3]]);
  };

export const buildCvatGroundConfig = (
  acquisition: CvatAcquisition,
): XYZBackgroundLayer => ({
  type: 'XYZ',
  layerName: 'lidarCvat',
  url: cvatTileUrl(acquisition.path),
  projection: CVAT_CRS,
  minZoom: acquisition.minZoom,
  maxZoom: acquisition.maxZoom,
  preload: 2,
  interpolate: false,
  coverageExtent: acquisition.extent25833
    ? { extent: acquisition.extent25833, crs: CVAT_CRS }
    : { extent: acquisition.project.bboxLonLat, crs: 'EPSG:4326' },
  coverageMask: cvatCoverageMask(acquisition.project),
});

export const CVAT_RENDERER = 'RVT';
export const CVAT_TEMPLATE = 'VAT_Combined';

export const CVAT_RADIUS_PX = { general: 10, flat: 20 } as const;
