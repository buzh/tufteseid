import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import { getArea } from 'ol/sphere';
import { LocalityBbox } from '../api/localities';
import { bboxSpanMetres } from './bboxLimits';

// How big is the area I'm looking at — the one number about a lokalitet
// rectangle that isn't obvious from the map. Hectares up to a square
// kilometre (the scale an amateur actually walks), km² above it.
export const formatBboxArea = (bbox: LocalityBbox, locale: string): string => {
  const m2 = getArea(polygonFromExtent(bbox), { projection: 'EPSG:4326' });
  const inHectares = m2 < 1_000_000;
  const value = inHectares ? m2 / 10_000 : m2 / 1_000_000;
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
  return `${formatted} ${inHectares ? 'ha' : 'km²'}`;
};

/*
 * The two sides on the ground — "620 × 480 m".
 *
 * Beside the area rather than instead of it, while a rectangle is being
 * placed: the area is what the site *is*, but the sides are what the size band
 * is written in (`bboxLimits.ts`), so a drag that stops has to be readable in
 * the same units as the rule that stopped it.
 *
 * Kilometres above 2 km, which only an old record can reach — the band tops
 * out at 1500 m.
 */
export const formatBboxSpan = (bbox: LocalityBbox, locale: string): string => {
  const [width, height] = bboxSpanMetres(bbox);
  const inKm = Math.max(width, height) >= 2000;
  const format = (metres: number) =>
    new Intl.NumberFormat(locale, {
      maximumFractionDigits: inKm ? 1 : 0,
    }).format(inKm ? metres / 1000 : metres);
  return `${format(width)} × ${format(height)} ${inKm ? 'km' : 'm'}`;
};

/*
 * Centre of the rectangle, as decimal degrees with a hemisphere letter.
 *
 * Derived on every render rather than stored: "Juster området" moves the
 * rectangle, and a coordinate saved at creation would quietly start
 * describing somewhere the lokalitet no longer is. Five decimals is ~1 m,
 * which is finer than the rectangle is authored to anyway.
 *
 * Hemisphere letters are the Norwegian ones (N/S, Ø/V) in every locale —
 * they are read against Norwegian maps, and the app's other coordinate
 * readouts do the same.
 */
export const formatBboxCentre = (bbox: LocalityBbox): string => {
  const lon = (bbox[0] + bbox[2]) / 2;
  const lat = (bbox[1] + bbox[3]) / 2;
  const deg = (value: number, positive: string, negative: string) =>
    `${Math.abs(value).toFixed(5)}° ${value < 0 ? negative : positive}`;
  return `${deg(lat, 'N', 'S')}, ${deg(lon, 'Ø', 'V')}`;
};

// PocketBase timestamps come back as "2026-09-04 08:12:33.123Z", which
// Safari refuses to parse — the space has to become a T first.
export const formatDate = (iso: string, locale: string): string => {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
};
