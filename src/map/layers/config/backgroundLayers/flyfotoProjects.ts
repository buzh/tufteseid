import { transformExtent } from 'ol/proj';
import type { Bbox } from '../../../bbox';
import { fetchWithin } from '../../../../shared/utils/deadline';

const PROJECTS_TIMEOUT_MS = 20_000;

// Layer 4, "Prosjektomriss prosessert": one row per acquisition.
const PROJECTS_URL = '/arcgis/nib/prosjekter/MapServer/4/query';

// "Satellittbilde": nationwide 10 m Sentinel-2 mosaics, which would list under
// every rectangle.
const SATELLITE_ORTOFOTOTYPE = 6;

export type FlyfotoProject = {
  // prosjektnavn, which is also the ImageServer's mosaic-rule selector.
  id: string;
  projectName: string;
  year: number | null;
  // ISO from fotodato_date; sometimes disagrees with the year in the name.
  photoDate: string | null;
  metresPerPx: number | null;
  bboxLonLat: [number, number, number, number];
};

type QueryAttributes = {
  prosjektnavn?: string | null;
  aar?: number | null;
  fotodato_date?: number | null;
  ortofototype?: number | null;
  pixelstorrelse?: string | number | null;
  x_min?: number | null;
  y_min?: number | null;
  x_max?: number | null;
  y_max?: number | null;
};

function toNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// Formatted in UTC: these are dates, not instants, and local formatting can
// shift them a day.
function toIsoDate(epochMs: number | null | undefined): string | null {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return null;
  const d = new Date(epochMs);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toProject(attrs: QueryAttributes): FlyfotoProject | null {
  const projectName = attrs.prosjektnavn?.trim();
  if (!projectName) return null;
  if (attrs.ortofototype === SATELLITE_ORTOFOTOTYPE) return null;

  const minLon = toNumber(attrs.x_min);
  const minLat = toNumber(attrs.y_min);
  const maxLon = toNumber(attrs.x_max);
  const maxLat = toNumber(attrs.y_max);
  if (
    minLon === null ||
    minLat === null ||
    maxLon === null ||
    maxLat === null
  ) {
    return null;
  }

  return {
    id: projectName,
    projectName,
    year: toNumber(attrs.aar),
    photoDate: toIsoDate(attrs.fotodato_date),
    metresPerPx: toNumber(attrs.pixelstorrelse),
    bboxLonLat: [minLon, minLat, maxLon, maxLat],
  };
}

// The catalogue gains a row when a flight is processed, a handful of times a
// year, so one rectangle asked for twice in a sitting is the same answer. Held
// because a flyfoto run asks for the very same rectangle once per proposal:
// `renderEvidence` re-reads the catalogue to recover an acquisition's own
// resolution, and that round trip sits in front of the tile burst rather than
// beside it.
const CACHE_TTL_MS = 300_000;
// The picker walks a new rectangle on every pan, so this is bounded rather
// than complete. Oldest written out first — `Map` keeps insertion order.
const CACHE_MAX = 32;

const cache = new Map<string, { at: number; projects: FlyfotoProject[] }>();

function byNewest(a: FlyfotoProject, b: FlyfotoProject): number {
  const da = a.photoDate ?? (a.year !== null ? `${a.year}-00-00` : '');
  const db = b.photoDate ?? (b.year !== null ? `${b.year}-00-00` : '');
  if (da !== db) return da < db ? 1 : -1;
  return a.projectName.localeCompare(b.projectName, 'nb');
}

// The server filters against the real outlines, not their bounding boxes.
async function queryProjects(
  bbox4326: Bbox,
  signal?: AbortSignal,
): Promise<FlyfotoProject[]> {
  // The service wants a projected CRS.
  const bbox25833 = transformExtent(bbox4326, 'EPSG:4326', 'EPSG:25833');

  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    geometry: bbox25833.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '25833',
    spatialRel: 'esriSpatialRelIntersects',
    outFields:
      'prosjektnavn,aar,fotodato_date,ortofototype,pixelstorrelse,x_min,y_min,x_max,y_max',
    // The bounds are plain attributes, so the outlines need not come back.
    returnGeometry: 'false',
  });

  const body = await fetchWithin(
    `${PROJECTS_URL}?${params.toString()}`,
    { ms: PROJECTS_TIMEOUT_MS, what: 'flyfoto projects', signal },
    (res) => res.json(),
  );
  // ArcGIS reports failures as a 200 with an error envelope.
  if (body?.error) {
    throw new Error(
      `flyfoto projects: ${body.error.message ?? 'query failed'}`,
    );
  }

  const features: Array<{ attributes?: QueryAttributes }> =
    body?.features ?? [];
  const seen = new Set<string>();
  const projects: FlyfotoProject[] = [];
  for (const feature of features) {
    const project = toProject(feature.attributes ?? {});
    // More than one outline row per acquisition happens.
    if (!project || seen.has(project.id)) continue;
    seen.add(project.id);
    projects.push(project);
  }
  return projects.sort(byNewest);
}

export async function fetchFlyfotoProjectsForBbox(
  bbox4326: Bbox,
  signal?: AbortSignal,
): Promise<FlyfotoProject[]> {
  const key = bbox4326.join(',');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return [...hit.projects];

  // Only an answer is held. A failure is the upstream's mood rather than the
  // catalogue's contents, and the caller asking again is how it is retried.
  const projects = await queryProjects(bbox4326, signal);
  // Re-inserted, so the order is recency of write and not of first sight.
  cache.delete(key);
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), projects });
  return [...projects];
}
