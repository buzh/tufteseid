import type { SpotPoint } from '../api/spots';

/**
 * Five decimals — a bit over a metre at these latitudes, which is finer than
 * anybody places a pin by eye and short enough to read off the screen.
 * Norwegian hemisphere letters, because that is how a coordinate is written
 * here.
 */
export const formatPoint = ([lon, lat]: SpotPoint): string => {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'Ø' : 'V';
  return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lon).toFixed(5)}° ${ew}`;
};
