// Enumerates the Norge i bilder ortofoto acquisitions ("prosjekter") that
// cover a lokalitet, so the same ground can be kept as a temporal stack —
// 1937, 1963, 2011, 2024 — rather than only the single seamless mosaic
// that fetchFlyfoto() grabs by default.
//
// Source is NiB's own project index, layer 4 ("Prosjektomriss prosessert")
// of the prosjekter MapServer: one row per acquisition with its name,
// year, photo date and lon/lat bounds. Requests go same-origin through
// /arcgis/nib/* → wmscache → nib-proxy (which injects the token), same as
// the imagery itself.
//
// Deliberately NOT Kartverket's wms.georef_nib, which the layer name makes
// look like the obvious index: that service is a *planning* layer. Its
// features carry prosjektfase P/U and start years in the future, with the
// project-name fields empty — it describes photography that has not been
// flown yet, not the archive.

import { transformExtent } from 'ol/proj';
import type { LocalityBbox } from '../api/localities';

// Layer 4 of the prosjekter MapServer. Layer 1 ("Prosjektomriss original")
// holds the same rows but the unprocessed outlines; 2 and 3 are seam lines
// and per-photo frames, both far too granular for a picker.
const PROJECTS_URL = '/arcgis/nib/prosjekter/MapServer/4/query';

// ortofototype is a coded domain on that layer. 6 = "Satellittbilde",
// which is how the nationwide 10 m Sentinel-2 mosaics get in; they cover
// everywhere, so without this every lokalitet in the country lists them,
// and at 10 m/px they are useless next to 0.1 m aerial photography.
const SATELLITE_ORTOFOTOTYPE = 6;

export type FlyfotoProject = {
  // prosjektnavn — also the imagery selector, see flyfoto.ts. The two
  // come from the same table in the same database, so there is no name
  // matching to get wrong between index and renderer.
  id: string;
  projectName: string;
  year: number | null;
  // ISO yyyy-mm-dd, from fotodato_date. More precise than the year and
  // occasionally disagrees with the year in the project's own name.
  photoDate: string | null;
  // Native ground resolution in metres, when published.
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

// fotodato_date arrives as epoch milliseconds. Format in UTC: these are
// dates, not instants, and local formatting can shift them a day.
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

// Newest first — the ordering the picker shows. Falls back to the year
// when a row has no photo date, and to the name so the list is stable.
function byNewest(a: FlyfotoProject, b: FlyfotoProject): number {
  const da = a.photoDate ?? (a.year !== null ? `${a.year}-00-00` : '');
  const db = b.photoDate ?? (b.year !== null ? `${b.year}-00-00` : '');
  if (da !== db) return da < db ? 1 : -1;
  return a.projectName.localeCompare(b.projectName, 'nb');
}

// Every acquisition whose footprint intersects the lokalitet, newest
// first. The spatial filter runs against the real project outlines
// server-side, not their bounding boxes, so a project that only clips a
// neighbouring valley is already excluded here.
export async function fetchFlyfotoProjectsForBbox(
  bbox4326: LocalityBbox,
  signal?: AbortSignal,
): Promise<FlyfotoProject[]> {
  // The service takes the query envelope in a projected CRS; 25833 is
  // what the rest of the flyfoto path already works in.
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
    // Footprint geometry would dominate the response and we only need the
    // published lon/lat bounds, which come along as plain attributes.
    returnGeometry: 'false',
  });

  const res = await fetch(`${PROJECTS_URL}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`flyfoto projects HTTP ${res.status}`);
  const body = await res.json();
  // ArcGIS reports failures as a 200 with an error envelope.
  if (body?.error) {
    throw new Error(`flyfoto projects: ${body.error.message ?? 'query failed'}`);
  }

  const features: Array<{ attributes?: QueryAttributes }> = body?.features ?? [];
  const seen = new Set<string>();
  const projects: FlyfotoProject[] = [];
  for (const feature of features) {
    const project = toProject(feature.attributes ?? {});
    // A project occasionally has more than one outline row; the imagery
    // selector is the name, so extras would just be duplicate buttons.
    if (!project || seen.has(project.id)) continue;
    seen.add(project.id);
    projects.push(project);
  }
  return projects.sort(byNewest);
}
