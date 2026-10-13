import { t } from 'i18next';
import { fetchWithin } from '../../../../shared/utils/deadline';
import { getUrlParameter } from '../../../../shared/utils/urlUtils';
import { acrossHalves, halved } from '../../../compare/halves';

const CAPS_TIMEOUT_MS = 60_000;

export type LidarModel = 'dtm' | 'dom';

export type LidarProject = {

  id: string;
  projectName: string;
  year: number | null;
  pointDensity: string | null;
  bboxLonLat: [number, number, number, number];
  styles: string[];
};

const CAPS_URL =
  '/wms/geonorge/wms.hoyde-dtm-prosjekt?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0';

const STORAGE_KEY = 'lidarProjects.v4';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const activeLidarProjectHalves = halved<LidarProject | null>(null);

export const liveLidarProjectsAtom = acrossHalves(activeLidarProjectHalves);

export const linkedLidarRender = getUrlParameter('lidarRender');

export const activeLidarStyleHalves = halved<string>(
  linkedLidarRender ?? 'skyggerelieff',
);

export const activeLidarModelHalves = halved<LidarModel>(
  getUrlParameter('lidarModel') === 'dom' ? 'dom' : 'dtm',
);

export const LIDAR_PROJECT_WMS_URL: Record<LidarModel, string> = {
  dtm: '/wms/geonorge/wms.hoyde-dtm-prosjekt',
  dom: '/wms/geonorge/wms.hoyde-dom-prosjekt',
};

export const LIDAR_COVERAGE_EXTENT_25833: [number, number, number, number] = [
  -100275, 6399725, 1150255, 8000275,
];
export const DEFAULT_LIDAR_PROJECT_STYLE = 'skyggerelieff';

export const CVAT_STYLE = 'cvat';

const DOM_STYLES = [DEFAULT_LIDAR_PROJECT_STYLE];

export const stylesForModel = (
  styles: string[],
  model: LidarModel,
): string[] => (model === 'dom' ? DOM_STYLES : styles);

export const effectiveLidarStyle = (
  style: string,
  model: LidarModel,
): string => (model === 'dom' ? DOM_STYLES[0] : style);

export const lidarFlightGround = (
  style: string,
  model: LidarModel,
): 'lidarProject' | 'lidarCvat' =>
  effectiveLidarStyle(style, model) === CVAT_STYLE
    ? 'lidarCvat'
    : 'lidarProject';

export const wmsLidarStyle = (style: string): string =>
  style === CVAT_STYLE ? DEFAULT_LIDAR_PROJECT_STYLE : style;

export const TIER_A_STYLES = [
  CVAT_STYLE,
  'skyggerelieff',
  'multiskyggerelieff',
  'helning_prosent',
];

export const resolveLidarStyle = (
  published: string[],
  preferred: string,
): string =>
  published.includes(preferred)
    ? preferred
    : (TIER_A_STYLES.find((s) => published.includes(s)) ??
      published[0] ??
      DEFAULT_LIDAR_PROJECT_STYLE);

export const preferredLidarRender = (
  published: string[],
  preferred: string,
): string =>
  preferred === DEFAULT_LIDAR_PROJECT_STYLE && published.includes(CVAT_STYLE)
    ? CVAT_STYLE
    : resolveLidarStyle(published, preferred);

const EXCLUDED_STYLES = new Set<string>(['None', 'dynamisk_farget_hoyde']);

export const lidarStyleLabel = (style: string): string => {
  const known = t(`lidar.style.${style}`, { defaultValue: '' });
  if (known) return known;
  const spaced = style.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export const lidarStyleShort = (style: string): string =>
  t(`lidar.styleShort.${style}`, { defaultValue: '' }) ||
  lidarStyleLabel(style);

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

  }
}

export const densityValue = (d: string | null): number => {
  if (!d) return 0;
  const m = d.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
};

export const sortProjectsByRelevance = (
  a: LidarProject,
  b: LidarProject,
): number => {
  const ay = a.year ?? -Infinity;
  const by = b.year ?? -Infinity;
  if (ay !== by) return by - ay;
  const ad = densityValue(a.pointDensity);
  const bd = densityValue(b.pointDensity);
  if (ad !== bd) return bd - ad;
  return a.projectName.localeCompare(b.projectName);
};

export const bboxIntersects = (
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

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

export const NATIONAL_WMS: Record<LidarModel, { url: string; prefix: string }> =
  {
    dtm: {
      url: '/wms/geonorge/wms.hoyde-dtm-nhm-25833',
      prefix: 'NHM_DTM_25833',
    },
    dom: {
      url: '/wms/geonorge/wms.hoyde-dom-nhm-25833',
      prefix: 'NHM_DOM_25833',
    },
  };

const NATIONAL_CAPS_URL = `${NATIONAL_WMS.dtm.url}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0`;

const NATIONAL_STORAGE_KEY = 'lidarProjects.nationalStyles.v1';
const NATIONAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

  }
}
