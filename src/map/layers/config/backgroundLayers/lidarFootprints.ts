// Real coverage polygons from Kartverket's "Prosjektavgrensning" WFS, rather
// than the catalogue's envelope. Same-origin via /wfs/geonorge/, only user.

import GeoJSON from 'ol/format/GeoJSON';
import { Geometry } from 'ol/geom';
import { LidarProject } from './lidarProjects';

const WFS_URL = '/wfs/geonorge/wfs.hoyde-hoydedata-metadata-prosjekt';
const TYPE_NAME = 'metadata_prosjekt:Prosjektavgrensning';

export type LidarFootprint = {
  project: LidarProject;
  // A project can appear as several disjoint WFS features; keep every part.
  geometries: Geometry[];
};

// By name, never by BBOX: the ArcGIS spatial filter silently under-returns for
// narrow boxes, dropping the newest and densest acquisitions, and wide ones are
// uncompressed GeoJSON (4.4 MB at 33 km, a 504 past 65 km).

// The fes 2.0 predicate for one project; URLSearchParams encodes it, so only
// the three XML-significant characters need escaping here.
const buildNameFilter = (projectName: string): string => {
  const literal = projectName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return (
    '<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0">' +
    '<fes:PropertyIsEqualTo matchCase="false">' +
    '<fes:ValueReference>LAS_PROJECT_NAME</fes:ValueReference>' +
    `<fes:Literal>${literal}</fes:Literal>` +
    '</fes:PropertyIsEqualTo></fes:Filter>'
  );
};

// A few catalogue names differ from the WFS spelling only by the density token,
// so a miss retries without it — never as the primary key: 81 name groups
// differ by nothing else and would collapse onto one footprint.
const stripDensity = (name: string): string =>
  name
    .replace(/\b\d+\s*(pkt|pnt)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

const YEAR_TOLERANCE = 2;

type WfsProperties = {
  LAS_PROJECT_NAME?: string;
  AARSTALL?: number | string;
};

const crsUrn = (projection: string): string | undefined => {
  const m = projection.match(/EPSG:(\d+)/i);
  return m ? `urn:ogc:def:crs:EPSG::${m[1]}` : undefined;
};

// The legacy `crs` member this ArcGIS-backed WFS sets when output is not WGS84,
// whether or not SRSNAME was honoured.
const epsgFromCrsMember = (doc: unknown): string | undefined => {
  const name = (doc as { crs?: { properties?: { name?: string } } })?.crs
    ?.properties?.name;
  if (!name) return undefined;
  const m = name.match(/EPSG[:.]{1,2}(\d+)/i);
  return m ? `EPSG:${m[1]}` : undefined;
};

// Keyed by projection + project id, never expired since a boundary is static;
// negative results too. Bounded by count: an entry is 10s-100s kB.
const MAX_CACHE_ENTRIES = 400;
const cache = new Map<string, Promise<LidarFootprint | null>>();

// Map iterates in insertion order, so re-inserting on read makes eviction LRU.
const readCache = (key: string): Promise<LidarFootprint | null> | undefined => {
  const hit = cache.get(key);
  if (!hit) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
};

const writeCache = (key: string, value: Promise<LidarFootprint | null>) => {
  cache.set(key, value);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
};

// One WFS name query; null means no rows for that name.
const requestByName = async (
  project: LidarProject,
  projectName: string,
  projection: string,
): Promise<Geometry[] | null> => {
  const urn = crsUrn(projection);
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: TYPE_NAME,
    OUTPUTFORMAT: 'geojson',
    COUNT: '100',
    FILTER: buildNameFilter(projectName),
    ...(urn ? { SRSNAME: urn } : {}),
  });
  const res = await fetch(`${WFS_URL}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Prosjektavgrensning WFS returned ${res.status}`);
  }
  const json = await res.json();

  const dataProjection = epsgFromCrsMember(json) ?? projection;
  const features = new GeoJSON().readFeatures(json, {
    dataProjection,
    featureProjection: projection,
  });

  const geometries: Geometry[] = [];
  for (const feature of features) {
    const props = feature.getProperties() as WfsProperties;
    // Further out than a rounding of the flying date is a different project.
    const wfsYear = props.AARSTALL != null ? Number(props.AARSTALL) : null;
    if (
      project.year != null &&
      wfsYear != null &&
      Math.abs(project.year - wfsYear) > YEAR_TOLERANCE
    ) {
      continue;
    }
    const geometry = feature.getGeometry();
    if (geometry) geometries.push(geometry);
  }
  return geometries.length > 0 ? geometries : null;
};

// One project's boundary in the map's projection, or null if the WFS has none.
const fetchOne = (
  project: LidarProject,
  projection: string,
): Promise<LidarFootprint | null> => {
  const key = `${projection}|${project.id}`;
  const cached = readCache(key);
  if (cached) return cached;

  const promise = (async () => {
    let geometries = await requestByName(
      project,
      project.projectName,
      projection,
    );
    const stripped = stripDensity(project.projectName);
    if (!geometries && stripped !== project.projectName) {
      geometries = await requestByName(project, stripped, projection);
    }
    return geometries ? { project, geometries } : null;
  })();

  writeCache(key, promise);
  // A failed request must not become a permanent negative cache entry.
  promise.catch(() => cache.delete(key));
  return promise;
};

// ~0.2 s per answer, but roughly one request in five hangs outright.
const CONCURRENCY = 6;

// Keyed by LidarProject.id; projects with no boundary are absent. `projects`
// order is the fetch order, so pass the best candidates first.
export async function fetchLidarFootprints(
  projects: LidarProject[],
  projection: string,
): Promise<Map<string, LidarFootprint>> {
  const out = new Map<string, LidarFootprint>();
  const queue = [...projects];
  const worker = async () => {
    for (;;) {
      const project = queue.shift();
      if (!project) return;
      try {
        const footprint = await fetchOne(project, projection);
        if (footprint) out.set(project.id, footprint);
      } catch (err) {
        // One project's boundary failing shouldn't blank the whole list.
        console.warn('[lidarFootprints] %s failed', project.id, err);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
  );
  return out;
}

// How much of the viewport a footprint paints, 0..1. Grid-sampled, since OL has
// no polygon intersection; `extent` and `geometries` share a metric CRS.
const COVERAGE_GRID = 24;

export const viewportCoverage = (
  geometries: Geometry[],
  extent: [number, number, number, number],
): number => {
  if (geometries.length === 0) return 0;
  const cellW = (extent[2] - extent[0]) / COVERAGE_GRID;
  const cellH = (extent[3] - extent[1]) / COVERAGE_GRID;
  if (cellW <= 0 || cellH <= 0) return 0;

  // The sample sees no finer than a cell; the argument is a squared tolerance.
  const tolerance = Math.min(cellW, cellH);
  const simplified = geometries.map((g) =>
    g.getSimplifiedGeometry(tolerance * tolerance),
  );

  let hits = 0;
  for (let ix = 0; ix < COVERAGE_GRID; ix++) {
    const x = extent[0] + (ix + 0.5) * cellW;
    for (let iy = 0; iy < COVERAGE_GRID; iy++) {
      const y = extent[1] + (iy + 0.5) * cellH;
      if (simplified.some((g) => g.intersectsCoordinate([x, y]))) hits++;
    }
  }
  return hits / (COVERAGE_GRID * COVERAGE_GRID);
};

// Stricter than the coverage sample: a project overlapping only by its envelope
// does not belong in the list.
export const touchesExtent = (
  geometries: Geometry[],
  extent: [number, number, number, number],
): boolean => geometries.some((g) => g.intersectsExtent(extent));
