import type Map from 'ol/Map';
import { transform } from 'ol/proj';

import type { SpotPoint } from '../api/spots';

/**
 * Where a spot goes when the `+` is pressed: the centre of the visible map, in
 * EPSG:4326. Null before the map has a size, i.e. before first layout.
 *
 * The view's own centre rather than a pixel, because there is nothing to inset
 * from — a point has no edges to keep on the screen, unlike the terrain
 * analysis's square (`map/bbox.ts`).
 */
export const viewportCentre4326 = (map: Map): SpotPoint | null => {
  if (!map.getSize()) return null;
  const view = map.getView();
  const centre = view.getCenter();
  if (!centre) return null;
  const [lon, lat] = transform(
    centre,
    view.getProjection().getCode(),
    'EPSG:4326',
  );
  return [lon, lat];
};

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
