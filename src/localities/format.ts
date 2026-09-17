import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import { getArea } from 'ol/sphere';
import { LocalityBbox } from '../api/localities';
import { bboxSpanMetres } from './bboxLimits';

// Hectares up to a square kilometre, km² above it.
export const formatBboxArea = (bbox: LocalityBbox, locale: string): string => {
  const m2 = getArea(polygonFromExtent(bbox), { projection: 'EPSG:4326' });
  const inHectares = m2 < 1_000_000;
  const value = inHectares ? m2 / 10_000 : m2 / 1_000_000;
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
  return `${formatted} ${inHectares ? 'ha' : 'km²'}`;
};

// The two sides on the ground, "620 × 480 m" — the units the size band in
// `bboxLimits.ts` is written in. Kilometres above 2 km, which only a record
// predating the band can reach.
export const formatBboxSpan = (bbox: LocalityBbox, locale: string): string => {
  const [width, height] = bboxSpanMetres(bbox);
  const inKm = Math.max(width, height) >= 2000;
  const format = (metres: number) =>
    new Intl.NumberFormat(locale, {
      maximumFractionDigits: inKm ? 1 : 0,
    }).format(inKm ? metres / 1000 : metres);
  return `${format(width)} × ${format(height)} ${inKm ? 'km' : 'm'}`;
};

// Derived per render rather than stored, so "Juster området" cannot leave a
// stale coordinate behind. Five decimals is ~1 m. Hemisphere letters are the
// Norwegian ones (N/S, Ø/V) in every locale.
export const formatBboxCentre = (bbox: LocalityBbox): string => {
  const lon = (bbox[0] + bbox[2]) / 2;
  const lat = (bbox[1] + bbox[3]) / 2;
  const deg = (value: number, positive: string, negative: string) =>
    `${Math.abs(value).toFixed(5)}° ${value < 0 ? negative : positive}`;
  return `${deg(lat, 'N', 'S')}, ${deg(lon, 'Ø', 'V')}`;
};

// PocketBase timestamps are "2026-09-04 08:12:33.123Z"; Safari refuses to
// parse that until the space becomes a T.
export const formatDate = (iso: string, locale: string): string => {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
};
