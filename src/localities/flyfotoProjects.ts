// The NiB ortofoto acquisitions ("prosjekter") over a lokalitet, from NiB's own
// project index. Not Kartverket's wms.georef_nib, which looks like the obvious
// index but is a planning layer: prosjektfase P/U, start years in the future,
// empty project names.

import { transformExtent } from 'ol/proj';
import type { LocalityBbox } from '../api/localities';
import { fetchWithin } from '../shared/utils/deadline';

// A ceiling on a stalled connection, not on the query.
const PROJECTS_TIMEOUT_MS = 20_000;

// Layer 4, "Prosjektomriss prosessert": one row per acquisition. 1 is the same
// rows unprocessed; 2 and 3 are seam lines and per-photo frames.
const PROJECTS_URL = '/arcgis/nib/prosjekter/MapServer/4/query';

// ortofototype 6 = "Satellittbilde": the nationwide 10 m Sentinel-2 mosaics,
// which cover everywhere and would list under every lokalitet.
const SATELLITE_ORTOFOTOTYPE = 6;

export type FlyfotoProject = {
  // prosjektnavn, which is also the imagery selector in flyfoto.ts.
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

// Epoch milliseconds, formatted in UTC: these are dates, not instants, and
// local formatting can shift them a day.
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
  if (minLon === null || minLat === null || maxLon === null || maxLat === null) {
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

// Newest first, then the year, then the name, so the list is stable.
function byNewest(a: FlyfotoProject, b: FlyfotoProject): number {
  const da = a.photoDate ?? (a.year !== null ? `${a.year}-00-00` : '');
  const db = b.photoDate ?? (b.year !== null ? `${b.year}-00-00` : '');
  if (da !== db) return da < db ? 1 : -1;
  return a.projectName.localeCompare(b.projectName, 'nb');
}

// The server filters against the real outlines, not their bounding boxes.
export async function fetchFlyfotoProjectsForBbox(
  bbox4326: LocalityBbox,
  signal?: AbortSignal,
): Promise<FlyfotoProject[]> {
  // The service wants a projected CRS, and 25833 is the flyfoto path's.
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
    // The bounds come as plain attributes; the footprints would dominate.
    returnGeometry: 'false',
  });

  const body = await fetchWithin(
    `${PROJECTS_URL}?${params.toString()}`,
    { ms: PROJECTS_TIMEOUT_MS, what: 'flyfoto projects', signal },
    (res) => res.json(),
  );
  // ArcGIS reports failures as a 200 with an error envelope.
  if (body?.error) {
    throw new Error(`flyfoto projects: ${body.error.message ?? 'query failed'}`);
  }

  const features: Array<{ attributes?: QueryAttributes }> = body?.features ?? [];
  const seen = new Set<string>();
  const projects: FlyfotoProject[] = [];
  for (const feature of features) {
    const project = toProject(feature.attributes ?? {});
    // More than one outline row happens; the selector is the name, so extras
    // would only be duplicate buttons.
    if (!project || seen.has(project.id)) continue;
    seen.add(project.id);
    projects.push(project);
  }
  return projects.sort(byNewest);
}
