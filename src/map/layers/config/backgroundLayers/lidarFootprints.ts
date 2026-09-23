// Real coverage polygons from Kartverket's "Prosjektavgrensning" WFS, rather
// than the catalogue's envelope. Same-origin via /wfs/geonorge/, only user.

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

// Per page, and six of these run at once over up to sixty projects: without a
// budget of its own a stalled WFS parks the whole fan-out until the proxy gives
// up at thirty seconds, once per project. Well over the 300-900 ms a page takes.
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

// Features per request. A boundary with more disjoint parts than this comes
// back as a valid, short FeatureCollection — the truncation raises nothing, and
// reads on the map as a hole in the coverage — so the query pages until a page
// comes back short.
const PAGE_SIZE = 100;
// Far past any real boundary. The cap is there so a service that ignores
// STARTINDEX cannot keep the loop asking for the same page.
const MAX_PAGES = 25;

type NameQueryResult = {
  geometries: Geometry[];
  // Set when the paging stopped short of exhausting the rows. The parts in
  // hand are still worth drawing; they are not worth remembering.
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
    // and the rest of the rows are unreachable. Only when the service gives
    // ids at all — without them there is nothing to compare and paging on the
    // page length is the best available.
    const firstId = features[0].getId();
    if (firstId != null && firstId === previousFirstId) {
      truncated = true;
      break;
    }
    previousFirstId = firstId;

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

    if (features.length < PAGE_SIZE) break;
    startIndex += features.length;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return geometries.length > 0 ? { geometries, truncated } : null;
};

// One project's boundary in the map's projection, or null if the WFS has none.
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

  // Entries never expire, so anything that is not the whole answer has to be
  // taken back out: a failure, or a boundary the paging could not exhaust.
  // Only this promise's entry, though — eviction under pressure can already
  // have put a fresh one behind the same key.
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

/**
 * Every boundary that could be had, and whether the service said anything at
 * all.
 *
 * The second half is why this is not a bare Map. A failure is swallowed per
 * project below so one bad name cannot blank the list, and an origin the
 * breaker has closed fails every lookup instantly without a request — so a
 * whole-service outage and a viewport no flight covers both come back as an
 * empty map. Only the flag tells them apart, and the caller draws opposite
 * conclusions from them.
 */
export type LidarFootprintFetch = {
  /** Keyed by LidarProject.id; projects with no boundary are absent. */
  footprints: Map<string, LidarFootprint>;
  /**
   * Nothing was answered and something failed — the breaker refused the
   * fan-out, or every lookup in it went the way of the service. Implies an
   * empty `footprints`; false for an empty candidate list, which is an answer.
   */
  unanswered: boolean;
};

// `projects` order is the fetch order, so pass the best candidates first.
export async function fetchLidarFootprints(
  projects: LidarProject[],
  projection: string,
): Promise<LidarFootprintFetch> {
  const out = new Map<string, LidarFootprint>();
  const queue = [...projects];
  // A null boundary is an answer — the WFS has no rows under that name — so
  // this counts answers rather than hits.
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
        // The breaker is open: every remaining project would fail the same
        // way, instantly and without a request. Drop the queue rather than
        // walk sixty of them, and say nothing — the ribbon is already saying
        // it, once, for all of them.
        if (isUpstreamDown(err)) {
          queue.length = 0;
          return;
        }
        // One project's boundary failing shouldn't blank the whole list.
        console.warn('[lidarFootprints] %s failed', project.id, err);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
  );
  return { footprints: out, unanswered: answered === 0 && failed > 0 };
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
