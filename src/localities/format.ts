import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import { getArea } from 'ol/sphere';
import { LocalityBbox } from '../api/localities';

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

// PocketBase timestamps come back as "2026-09-04 08:12:33.123Z", which
// Safari refuses to parse — the space has to become a T first.
export const formatDate = (iso: string, locale: string): string => {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
};
