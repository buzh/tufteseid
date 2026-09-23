import GeoJSON from 'ol/format/GeoJSON';
import { Geometry } from 'ol/geom';
import { fetchWithin } from '../../../../shared/utils/deadline';
import { isUpstreamDown } from '../../../../upstream/health';
import { LidarProject } from './lidarProjects';

const WFS_URL = '/wfs/geonorge/wfs.hoyde-hoydedata-metadata-prosjekt';
const TYPE_NAME = 'metadata_prosjekt:Prosjektavgrensning';

export type LidarFootprint = {
  project: LidarProject;
  // A project can appear as several disjoint WFS features; keep every part.
  geometries: Geometry[];
};

// By name, never by BBOX: the ArcGIS spatial filter silently under-returns for
// narrow boxes, and wide ones are uncompressed GeoJSON (4.4 MB at 33 km, 504
// past 65 km). URLSearchParams handles the URL encoding.
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

// A fallback only: a few catalogue names differ from the WFS spelling by the
// density token alone, but 81 name groups differ by nothing else and would
// collapse onto one footprint if this were the primary key.
const stripDensity = (name: string): string =>
  name
    .replace(/\b\d+\s*(pkt|pnt)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

const YEAR_TOLERANCE = 2;

// Per page; a page takes 300-900 ms, and six of these run at once.
const PAGE_TIMEOUT_MS = 12000;

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

// A boundary is static, so entries never expire; bounded by count instead, an
// entry being 10s-100s kB.
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

// Features per request. Truncation raises nothing — an over-long boundary comes
// back as a valid short FeatureCollection — so the query pages until a page
// comes back short.
const PAGE_SIZE = 100;
// Cap so a service that ignores STARTINDEX cannot loop on the same page.
const MAX_PAGES = 25;

type NameQueryResult = {
  geometries: Geometry[];
  // The paging stopped short of exhausting the rows.
  truncated: boolean;
};

// One WFS name query, paged; null means no rows for that name.
const requestByName = async (
  project: LidarProject,
  projectName: string,
  projection: string,
): Promise<NameQueryResult | null> => {
  const urn = crsUrn(projection);
  const format = new GeoJSON();
  const geometries: Geometry[] = [];
  let truncated = false;
  let startIndex = 0;
  let previousFirstId: string | number | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      SERVICE: 'WFS',
      VERSION: '2.0.0',
      REQUEST: 'GetFeature',
      TYPENAMES: TYPE_NAME,
      OUTPUTFORMAT: 'geojson',
      COUNT: String(PAGE_SIZE),
      STARTINDEX: String(startIndex),
      FILTER: buildNameFilter(projectName),
      ...(urn ? { SRSNAME: urn } : {}),
    });
    const json = await fetchWithin(
      `${WFS_URL}?${params.toString()}`,
      { ms: PAGE_TIMEOUT_MS, what: `Prosjektavgrensning ${projectName}` },
      (res) => res.json(),
    );

    const dataProjection = epsgFromCrsMember(json) ?? projection;
    const features = format.readFeatures(json, {
      dataProjection,
      featureProjection: projection,
    });
    if (features.length === 0) break;

    // The same row opening two consecutive pages means STARTINDEX was ignored
    // and the rest are unreachable.
    const firstId = features[0].getId();
    if (firstId != null && firstId === previousFirstId) {
      truncated = true;
      break;
    }
    previousFirstId = firstId;

    for (const feature of features) {
      const props = feature.getProperties() as WfsProperties;
      // Beyond YEAR_TOLERANCE it is a different project under the same name.
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

    if (features.length < PAGE_SIZE) break;
    startIndex += features.length;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return geometries.length > 0 ? { geometries, truncated } : null;
};

// One project's boundary in `projection`, or null if the WFS has none.
const fetchOne = (
  project: LidarProject,
  projection: string,
): Promise<LidarFootprint | null> => {
  const key = `${projection}|${project.id}`;
  const cached = readCache(key);
  if (cached) return cached;

  let truncated = false;
  const promise = (async () => {
    let result = await requestByName(project, project.projectName, projection);
    const stripped = stripDensity(project.projectName);
    if (!result && stripped !== project.projectName) {
      result = await requestByName(project, stripped, projection);
    }
    if (!result) return null;
    truncated = result.truncated;
    return { project, geometries: result.geometries };
  })();

  writeCache(key, promise);

  // Entries never expire, so anything short of the whole answer comes back out.
  // Only this promise's own entry: eviction may already have replaced the key.
  const forget = () => {
    if (cache.get(key) === promise) cache.delete(key);
  };
  promise.then(() => {
    if (!truncated) return;
    console.warn('[lidarFootprints] %s boundary came back short', project.id);
    forget();
  }, forget);
  return promise;
};

// ~0.2 s per answer, but roughly one request in five hangs outright.
const CONCURRENCY = 6;

export type LidarFootprintFetch = {
  /** Keyed by LidarProject.id; projects with no boundary are absent. */
  footprints: Map<string, LidarFootprint>;
  /** Nothing was answered and something failed — a service outage, as opposed
   *  to a viewport no flight covers. False for an empty candidate list. */
  unanswered: boolean;
};

// `projects` order is the fetch order, so pass the best candidates first.
export async function fetchLidarFootprints(
  projects: LidarProject[],
  projection: string,
): Promise<LidarFootprintFetch> {
  const out = new Map<string, LidarFootprint>();
  const queue = [...projects];
  // A null boundary is an answer: the WFS has no rows under that name.
  let answered = 0;
  let failed = 0;
  const worker = async () => {
    for (;;) {
      const project = queue.shift();
      if (!project) return;
      try {
        const footprint = await fetchOne(project, projection);
        answered++;
        if (footprint) out.set(project.id, footprint);
      } catch (err) {
        failed++;
        // Breaker open: every remaining project would fail the same way.
        if (isUpstreamDown(err)) {
          queue.length = 0;
          return;
        }
        console.warn('[lidarFootprints] %s failed', project.id, err);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
  );
  return { footprints: out, unanswered: answered === 0 && failed > 0 };
}

// Samples per axis. Grid-sampled because OL has no polygon intersection;
// `extent` and `geometries` must share a metric CRS.
const COVERAGE_GRID = 24;

// How much of `extent` the footprint paints, 0..1.
export const viewportCoverage = (
  geometries: Geometry[],
  extent: [number, number, number, number],
): number => {
  if (geometries.length === 0) return 0;
  const cellW = (extent[2] - extent[0]) / COVERAGE_GRID;
  const cellH = (extent[3] - extent[1]) / COVERAGE_GRID;
  if (cellW <= 0 || cellH <= 0) return 0;

  // The sample sees no finer than a cell; getSimplifiedGeometry wants the
  // tolerance squared.
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

// Stricter than the coverage sample: real geometry, not the envelope.
export const touchesExtent = (
  geometries: Geometry[],
  extent: [number, number, number, number],
): boolean => geometries.some((g) => g.intersectsExtent(extent));
