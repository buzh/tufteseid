// Kartverket's per-project LiDAR GetCapabilities, parsed into one entry per
// acquisition; long-cached in wmscache plus a week of localStorage here.

import { t } from 'i18next';
import { fetchWithin } from '../../../../shared/utils/deadline';
import { getUrlParameter } from '../../../../shared/utils/urlUtils';
import { acrossHalves, halved } from '../../../compare/halves';

// Roomy: the document is some 8 MB of XML the proxy may be fetching cold.
const CAPS_TIMEOUT_MS = 60_000;

// The two services publish identical project sets, so a model is only another
// URL and layer prefix.
export type LidarModel = 'dtm' | 'dom';

export type LidarProject = {
  // Full WMS layer-name prefix, e.g. "Vestfold 10pkt 2025".
  id: string;
  projectName: string;
  year: number | null;
  pointDensity: string | null;
  bboxLonLat: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  styles: string[]; // e.g. ["skyggerelieff", "helning_grader", ...]
};

const CAPS_URL =
  '/wms/geonorge/wms.hoyde-dtm-prosjekt?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0';
// Bump when the parser output shape or filtering changes.
const STORAGE_KEY = 'lidarProjects.v4';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// What the background effect builds a WMS request from under 'lidarProject'.
export const activeLidarProjectHalves = halved<LidarProject | null>(null);

/** The flight each drawing half is on, for the footprint the map outlines. */
export const liveLidarProjectsAtom = acrossHalves(activeLidarProjectHalves);

// Holds the picked DTM style: DOM has one, so effectiveLidarStyle overrides
// rather than overwrites and the DTM choice survives the trip.
export const activeLidarStyleHalves = halved<string>('skyggerelieff');

export const activeLidarModelHalves = halved<LidarModel>(
  getUrlParameter('lidarModel') === 'dom' ? 'dom' : 'dtm',
);

export const LIDAR_PROJECT_WMS_URL: Record<LidarModel, string> = {
  dtm: '/wms/geonorge/wms.hoyde-dtm-prosjekt',
  dom: '/wms/geonorge/wms.hoyde-dom-prosjekt',
};

// The services' own `<BoundingBox CRS="EPSG:25833">`, handed to the layer as
// `extent`: a TileWMS without one tiles the whole UTM zone.
export const LIDAR_COVERAGE_EXTENT_25833: [number, number, number, number] = [
  -100275, 6399725, 1150255, 8000275,
];
export const DEFAULT_LIDAR_PROJECT_STYLE = 'skyggerelieff';

/**
 * Our own cached VAT, as a member of the style vocabulary.
 *
 * It is not a WMS style and no service publishes it — it is a rendering of a
 * flight, the same role `skyggerelieff` plays when Kartverket's WMS renders
 * one, and it belongs in the same tier. `cvatGround.ts` owns the pixels;
 * everything here is about where the choice sits.
 */
export const CVAT_STYLE = 'cvat';

// Every DOM layer publishes skyggerelieff and the excluded
// dynamisk_farget_hoyde, so a constant rather than a second caps fetch.
const DOM_STYLES = [DEFAULT_LIDAR_PROJECT_STYLE];

export const stylesForModel = (
  styles: string[],
  model: LidarModel,
): string[] => (model === 'dom' ? DOM_STYLES : styles);

// The style actually requested: asking a DOM layer for one it does not publish
// fails silently (see resolveLidarStyle), so the model wins. The cache goes the
// same way — it was computed from terrain, so DOM leaves it for the WMS.
export const effectiveLidarStyle = (
  style: string,
  model: LidarModel,
): string => (model === 'dom' ? DOM_STYLES[0] : style);

/**
 * Which of the two flight grounds a render lands on.
 *
 * The flight is the dataset; whether its relief comes off our own disk or off
 * Kartverket's WMS is the render chosen on it, and the layer name is the only
 * thing that carries which — the URL, a saved screenshot's `meta.ground` and
 * the figure plate all read it. One namer, because a surface that moved the
 * style or the model without it would put `cvat` in a GetMap.
 */
export const lidarFlightGround = (
  style: string,
  model: LidarModel,
): 'lidarProject' | 'lidarCvat' =>
  effectiveLidarStyle(style, model) === CVAT_STYLE
    ? 'lidarCvat'
    : 'lidarProject';

/**
 * The style a WMS may be asked for. The cache has no service behind it, so a
 * stitch of that ground asks the flight's own WMS for the plain hillshade —
 * the nearest thing upstream has to what is on screen.
 */
export const wmsLidarStyle = (style: string): string =>
  style === CVAT_STYLE ? DEFAULT_LIDAR_PROJECT_STYLE : style;

// Shown first in the style pulldown; anything else sits behind its overflow.
// The cache leads it where the store has the flight: it is the best picture we
// have of that ground.
export const TIER_A_STYLES = [
  CVAT_STYLE,
  'skyggerelieff',
  'multiskyggerelieff',
  'helning_prosent',
];

// The national mosaic publishes only skyggerelieff; asking it for a per-project
// style answers HTTP 200 image/png with a ~100 byte JSON error body. `cvat` is
// never in a mosaic's list and only in a flight's where the store holds it, so
// the same clamp carries a render off the cache onto a ground that has none.
export const resolveLidarStyle = (
  published: string[],
  preferred: string,
): string =>
  published.includes(preferred)
    ? preferred
    : (TIER_A_STYLES.find((s) => published.includes(s)) ??
      published[0] ??
      DEFAULT_LIDAR_PROJECT_STYLE);

/**
 * The clamp above, plus the one upgrade: skyggerelieff is the default nobody
 * reached for and `cvat` is the same hillshade computed better, so a flight the
 * store holds is rendered from our own disk. A style the reader did reach for —
 * a slope, a multi-directional shade — is a different picture and is kept.
 *
 * Deliberately not inside `resolveLidarStyle`: recreating a saved View has to
 * give back the render it recorded, and a View that recorded the WMS hillshade
 * would come back off the cache instead.
 */
export const preferredLidarRender = (
  published: string[],
  preferred: string,
): string =>
  preferred === DEFAULT_LIDAR_PROJECT_STYLE && published.includes(CVAT_STYLE)
    ? CVAT_STYLE
    : resolveLidarStyle(published, preferred);

// Advertised but unusable: `None` renders near-uniform, and
// `dynamisk_farget_hoyde` ramps per tile, so neighbouring tiles disagree.
const EXCLUDED_STYLES = new Set<string>(['None', 'dynamisk_farget_hoyde']);

/**
 * The suffix in Norwegian prose, for wherever a reader is being told which
 * render they are looking at. The raw suffix stays the reproducibility
 * contract, so this never replaces it — it sits beside it.
 *
 * The list comes from GetCapabilities rather than from here, so an unadvertised
 * suffix is prettified instead of dropped: five is what the two services
 * publish today, not a closed set.
 */
export const lidarStyleLabel = (style: string): string => {
  const known = t(`lidar.style.${style}`, { defaultValue: '' });
  if (known) return known;
  const spaced = style.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

type CachedEntry = { ts: number; projects: LidarProject[] };

let inflight: Promise<LidarProject[]> | null = null;

export function fetchLidarProjects(): Promise<LidarProject[]> {
  if (inflight) return inflight;
  const cached = readCache();
  if (cached) return Promise.resolve(cached);
  inflight = (async () => {
    try {
      const xml = await fetchWithin(
        CAPS_URL,
        { ms: CAPS_TIMEOUT_MS, what: 'LiDAR GetCapabilities' },
        (res) => res.text(),
      );
      const projects = parseCapabilities(xml);
      writeCache(projects);
      return projects;
    } catch (err) {
      // Past the week, but still the catalogue. Acquisitions are added to this
      // document, not revised, so an old copy names the same flights over the
      // same ground and is only missing the newest — against which the
      // alternative is a reader who can pick no dataset at all until Kartverket
      // answers again. The TTL is there to pick up new flights, and that is
      // worth nothing during an outage. The `ts` is deliberately left alone, so
      // the next call tries the network again.
      const stale = readCache(true);
      if (!stale) throw err;
      console.warn('[lidar] catalogue unavailable; using the stale copy', err);
      return stale;
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

function parseCapabilities(xmlText: string): LidarProject[] {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('GetCapabilities XML parse error');
  }

  const grouped = new Map<
    string,
    { styles: Set<string>; bboxes: [number, number, number, number][] }
  >();

  for (const layer of Array.from(doc.getElementsByTagName('Layer'))) {
    const name = layer.getElementsByTagName('Name')[0]?.textContent?.trim();
    if (!name || !name.includes(':')) continue;
    const colon = name.indexOf(':');
    const projectName = name.slice(0, colon);
    const style = name.slice(colon + 1);
    const bbox = readBboxFromLayerOrAncestor(layer);
    const entry = grouped.get(projectName) ?? {
      styles: new Set<string>(),
      bboxes: [],
    };
    entry.styles.add(style);
    if (bbox) entry.bboxes.push(bbox);
    grouped.set(projectName, entry);
  }

  const out: LidarProject[] = [];
  for (const [projectName, { styles, bboxes }] of grouped) {
    const bboxLonLat = unionBbox(bboxes);
    if (!bboxLonLat) continue;
    // Photogrammetry DTMs: a lidar project's styles advertised, blank tiles.
    if (/^Bilde\b/i.test(projectName)) continue;
    out.push({
      id: projectName,
      projectName,
      year: parseYear(projectName),
      pointDensity: parsePointDensity(projectName),
      bboxLonLat,
      styles: Array.from(styles)
        .filter((s) => !EXCLUDED_STYLES.has(s))
        .sort(),
    });
  }
  return out;
}

function readBboxFromLayerOrAncestor(
  layer: Element,
): [number, number, number, number] | null {
  // WMS 1.3.0 lets a child <Layer> inherit EX_GeographicBoundingBox.
  let el: Element | null = layer;
  while (el && el.tagName === 'Layer') {
    const direct = Array.from(el.children).find(
      (c) => c.tagName === 'EX_GeographicBoundingBox',
    );
    if (direct) {
      const west = num(direct, 'westBoundLongitude');
      const east = num(direct, 'eastBoundLongitude');
      const south = num(direct, 'southBoundLatitude');
      const north = num(direct, 'northBoundLatitude');
      if ([west, east, south, north].every((v) => Number.isFinite(v))) {
        return [west, south, east, north];
      }
    }
    el = el.parentElement;
  }
  return null;
}

function num(parent: Element, tag: string): number {
  return parseFloat(parent.getElementsByTagName(tag)[0]?.textContent ?? 'NaN');
}

function unionBbox(
  bboxes: [number, number, number, number][],
): [number, number, number, number] | null {
  if (bboxes.length === 0) return null;
  let [minLon, minLat, maxLon, maxLat] = bboxes[0];
  for (let i = 1; i < bboxes.length; i++) {
    const b = bboxes[i];
    if (b[0] < minLon) minLon = b[0];
    if (b[1] < minLat) minLat = b[1];
    if (b[2] > maxLon) maxLon = b[2];
    if (b[3] > maxLat) maxLat = b[3];
  }
  return [minLon, minLat, maxLon, maxLat];
}

// Exported for the cached ground, which reads the same facts off the same
// acquisition name when the catalogue has no row to read them from.
export function parseYear(name: string): number | null {
  const m = name.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

export function parsePointDensity(name: string): string | null {
  const m = name.match(/\b(\d+)\s*(pkt|pnt)\b/i);
  return m ? `${m[1]}${m[2].toLowerCase()}` : null;
}

function readCache(stale = false): LidarProject[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (!stale && Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.projects;
  } catch {
    return null;
  }
}

function writeCache(projects: LidarProject[]) {
  try {
    const entry: CachedEntry = { ts: Date.now(), projects };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore quota / unavailable storage.
  }
}

// pointDensity is a string like "10pkt"; the leading digits order it.
export const densityOrder = (d: string | null): number => {
  if (!d) return 0;
  const m = d.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
};

// The display order for every LiDAR project list in the app.
export const sortProjectsByRelevance = (
  a: LidarProject,
  b: LidarProject,
): number => {
  const ay = a.year ?? -Infinity;
  const by = b.year ?? -Infinity;
  if (ay !== by) return by - ay;
  const ad = densityOrder(a.pointDensity);
  const bd = densityOrder(b.pointDensity);
  if (ad !== bd) return bd - ad;
  return a.projectName.localeCompare(b.projectName);
};

export const bboxIntersects = (
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

// Fraction of `viewport` covered by `bbox`, both lon/lat; an upper bound, since
// the catalogue knows only envelopes.
export const bboxOverlapRatio = (
  bbox: [number, number, number, number],
  viewport: [number, number, number, number],
): number => {
  const w = Math.min(bbox[2], viewport[2]) - Math.max(bbox[0], viewport[0]);
  const h = Math.min(bbox[3], viewport[3]) - Math.max(bbox[1], viewport[1]);
  if (w <= 0 || h <= 0) return 0;
  const area = (viewport[2] - viewport[0]) * (viewport[3] - viewport[1]);
  return area > 0 ? (w * h) / area : 0;
};

// ---- National mosaic styles ----

// One service per model, styled variants under a single fixed layer prefix;
// only the DTM one carries bathymetry.
export const NATIONAL_WMS: Record<LidarModel, { url: string; prefix: string }> =
  {
    dtm: {
      url: '/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833',
      prefix: 'NHM_DTM_TOPOBATHY_25833',
    },
    dom: {
      url: '/wms/geonorge/wms.hoyde-dom-nhm-25833',
      prefix: 'NHM_DOM_25833',
    },
  };

// Only the DTM mosaic's styles are discovered at runtime; DOM is DOM_STYLES.
const NATIONAL_CAPS_URL = `${NATIONAL_WMS.dtm.url}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0`;
// Bump when the parser filter changes.
const NATIONAL_STORAGE_KEY = 'lidarProjects.nationalStyles.v1';
const NATIONAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// A floor, so the UI still has something to offer when caps is down.
const NATIONAL_FALLBACK_STYLES = [DEFAULT_LIDAR_PROJECT_STYLE];

let nationalInflight: Promise<string[]> | null = null;

export function fetchNationalLidarStyles(): Promise<string[]> {
  if (nationalInflight) return nationalInflight;
  const cached = readNationalCache();
  if (cached) return Promise.resolve(cached);
  nationalInflight = (async () => {
    try {
      const xml = await fetchWithin(
        NATIONAL_CAPS_URL,
        { ms: CAPS_TIMEOUT_MS, what: 'national GetCapabilities' },
        (res) => res.text(),
      );
      const styles = parseStylesForPrefix(xml, NATIONAL_WMS.dtm.prefix);
      const out = styles.length > 0 ? styles : NATIONAL_FALLBACK_STYLES;
      writeNationalCache(out);
      return out;
    } catch {
      return NATIONAL_FALLBACK_STYLES;
    }
  })().finally(() => {
    nationalInflight = null;
  });
  return nationalInflight;
}

function parseStylesForPrefix(xmlText: string, prefix: string): string[] {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return [];
  const styles = new Set<string>();
  for (const layer of Array.from(doc.getElementsByTagName('Layer'))) {
    const name = layer.getElementsByTagName('Name')[0]?.textContent?.trim();
    if (!name || !name.startsWith(prefix + ':')) continue;
    const suffix = name.slice(prefix.length + 1);
    if (EXCLUDED_STYLES.has(suffix)) continue;
    styles.add(suffix);
  }
  return Array.from(styles).sort();
}

function readNationalCache(): string[] | null {
  try {
    const raw = localStorage.getItem(NATIONAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; styles: string[] };
    if (Date.now() - parsed.ts > NATIONAL_TTL_MS) return null;
    return parsed.styles;
  } catch {
    return null;
  }
}

function writeNationalCache(styles: string[]) {
  try {
    localStorage.setItem(
      NATIONAL_STORAGE_KEY,
      JSON.stringify({ ts: Date.now(), styles }),
    );
  } catch {
    /* quota / unavailable */
  }
}
