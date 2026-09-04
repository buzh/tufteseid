// Real per-project LiDAR coverage footprints — Kartverket's
// "Prosjektavgrensning" (project boundary) WFS, the same service that
// backs høydedata.no's project map. It is the sole source of truth for
// "does this project actually cover the viewport": real polygon-vs-
// viewport intersection, not the catalogue's envelope.
//
// Routed same-origin through wmscache (/wfs/geonorge/ →
// wfs.geonorge.no/skwms1/ — same path shape as api/kulturminnerWfs.ts).
//
// Footprints are fetched ONE PROJECT AT A TIME, by name, and never by
// BBOX. See "Why not a BBOX query" below — that is the whole point of
// this module's shape.

import GeoJSON from 'ol/format/GeoJSON';
import { Geometry } from 'ol/geom';
import { LidarProject } from './lidarProjects';

const WFS_URL = '/wfs/geonorge/wfs.hoyde-hoydedata-metadata-prosjekt';
const TYPE_NAME = 'metadata_prosjekt:Prosjektavgrensning';

export type LidarFootprint = {
  project: LidarProject;
  // A project can appear as several disjoint WFS features (sub-areas);
  // keep every part rather than merging geometry.
  geometries: Geometry[];
};

// --- Why not a BBOX query ---
//
// This used to ask the WFS for every boundary intersecting the viewport
// and join the answer against the catalogue by name. That is the obvious
// shape, and it is wrong: the service is ArcGIS Server, and its spatial
// filter is approximate in both directions — it over-returns for wide
// boxes (features tens of km outside them) and, fatally, *under*-returns
// for narrow ones. Measured against the origin directly, with this proxy
// out of the path, at Skien (188562, 6569064 in EPSG:25833), where three
// projects genuinely contain the point:
//
//     query box   projects returned that contain the point
//       2 km      1  (Skien 2008)
//       3 km      2
//       4 km      3  ← complete
//      33 km      3
//
// The same probe in Trondheim and Oslo needed a 33 km box before the
// answer was complete, and what it dropped below that was consistently
// the newest, densest acquisition — NDH Trondheim 30pkt 2022, Oslo 10pkt
// 2024 — i.e. exactly the datasets worth opening. Nested boxes are not
// even monotonic: a 6 km box returned features a 16 km box did not.
// (This is what "the projects only show up if I zoom out to z13" was.)
//
// So a BBOX query is only trustworthy zoomed way out, which is where it
// is also unaffordable: the responses are uncompressed GeoJSON growing
// with area — 1.3 MB across 4 km, 4.4 MB across 33 km, 7 MB across
// 65 km, and a 504 past that.
//
// A name filter has neither problem. The catalogue prefilter in
// map/lidarFootprintsLayer.ts already yields a *complete* candidate set
// — GetCapabilities bounding boxes are true envelopes, so it can only
// over-include — and asking for one named project returns one project:
// 0.1–0.3 s, 10–600 KB, correct at any zoom. 110 catalogue names sampled
// across the country, including every one containing æøå or punctuation,
// matched a case-insensitive name filter on the first try.
//
// It is also cacheable in a way a viewport query never was: a project's
// boundary is immutable, so a response is good forever. Hence the
// unbounded-TTL memo below and the cached nginx location fronting this
// one WFS in nginx/wms-cache.conf.

// The fes 2.0 predicate for one project. Only the three XML-significant
// characters need escaping; the whole thing is URL-encoded on the way
// out by URLSearchParams.
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

// A handful of catalogue names differ from the WFS spelling only by the
// point-density token, so a miss is retried without it. Kept as a
// fallback rather than the primary key because 81 name groups in the WMS
// catalogue (169 of 1938 projects) differ by *nothing* else — Selbu 2pkt
// / 024pkt / 5pkt 2007, Gjerdrum 5pkt / 50pkt 2021 — and matching on the
// stripped name would collapse all their footprints onto one.
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

// A GeoJSON FeatureCollection's optional legacy `crs` member — ArcGIS-
// backed WFS servers (this one included) set it when the output isn't
// plain WGS84, which lets us interpret coordinates correctly regardless
// of whether the server actually honored our SRSNAME request.
const epsgFromCrsMember = (doc: unknown): string | undefined => {
  const name = (
    doc as { crs?: { properties?: { name?: string } } }
  )?.crs?.properties?.name;
  if (!name) return undefined;
  const m = name.match(/EPSG[:.]{1,2}(\d+)/i);
  return m ? `EPSG:${m[1]}` : undefined;
};

// Keyed by projection + project id, never expired: a project boundary is
// static for the lifetime of the tab (and, thanks to the cached nginx
// location, well beyond it). Negative results are cached too — a
// project with no WFS row must not be re-asked on every pan.
//
// Bounded by count rather than TTL. An entry is one project's parsed
// geometry, tens to hundreds of KB; a few hundred is a session's worth of
// browsing one region without letting a long session grow without limit.
const MAX_CACHE_ENTRIES = 400;
const cache = new Map<string, Promise<LidarFootprint | null>>();

// Map iterates in insertion order, so re-inserting on read is what makes
// the eviction below least-*recently*-used rather than oldest-first.
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

// One WFS name query, reduced to the geometry parts that belong to this
// catalogue entry. Null means "no rows for that name".
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
    // Same name, different acquisition: the catalogue and the WFS agree
    // on the year to within a rounding of when the flying happened, so
    // anything further out is a different project that happens to share
    // a name.
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

// One project's boundary, in the map's projection. Resolves to null when
// the WFS has no row for it.
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

// How many name queries may be in flight at once. The WFS answers one in
// ~0.2 s but hangs outright on roughly one request in five (see the
// retry note in nginx/wms-cache.conf), so a wide fan-out mostly buys
// more simultaneous hangs.
const CONCURRENCY = 6;

// Footprints for `projects`, keyed by LidarProject.id. Projects the WFS
// has no boundary for are simply absent from the result. Order of
// `projects` is the fetch order, so callers that cap the list should
// pass the most relevant candidates first.
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

// How much of the viewport a project's footprint actually paints, 0..1.
//
// Sampled on a grid rather than clipped analytically: OL has no polygon
// intersection, and a topology library is a lot of bytes for a number
// that only orders a list. A 24×24 grid resolves under 0.2% of the
// screen — far finer than either the ordering or the "minste andel av
// synsfeltet" filter can act on.
//
// `extent` and `geometries` must be in the same (projected, metric)
// coordinate system, which they are: readFeatures reprojects to the
// view's projection.
const COVERAGE_GRID = 24;

export const viewportCoverage = (
  geometries: Geometry[],
  extent: [number, number, number, number],
): number => {
  if (geometries.length === 0) return 0;
  const cellW = (extent[2] - extent[0]) / COVERAGE_GRID;
  const cellH = (extent[3] - extent[1]) / COVERAGE_GRID;
  if (cellW <= 0 || cellH <= 0) return 0;

  // Boundary polygons run to thousands of vertices, and the sample can't
  // see detail finer than a cell anyway. getSimplifiedGeometry takes a
  // *squared* tolerance.
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

// Whether any part of the footprint falls inside the viewport at all.
// Cheaper and stricter than the coverage sample: a project that clips a
// corner still belongs in the list (bottom of it), but one whose only
// overlap with the viewport is its envelope's does not.
export const touchesExtent = (
  geometries: Geometry[],
  extent: [number, number, number, number],
): boolean => geometries.some((g) => g.intersectsExtent(extent));
</content>
