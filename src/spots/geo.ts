import type { SpotPoint } from '../api/spots';

/** Lon/lat, EPSG:4326, with Norwegian hemisphere letters. */
export const formatPoint = ([lon, lat]: SpotPoint): string => {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'Ø' : 'V';
  return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lon).toFixed(5)}° ${ew}`;
};
