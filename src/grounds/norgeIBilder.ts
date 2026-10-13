import type Map from 'ol/Map';
import { transformExtent } from 'ol/proj';
import type { Metric } from '../map/bbox';

const VIEWER = 'https://norgeibilder.no/';

export const norgeIBilderUrl = (map: Map): string => {
  const size = map.getSize();
  if (!size) return VIEWER;

  const view = map.getView();
  const extent = transformExtent(
    view.calculateExtent(size),
    view.getProjection(),
    'EPSG:25833',
  ) as Metric;
  if (!extent.every(Number.isFinite)) return VIEWER;

  const [xmin, ymin, xmax, ymax] = extent.map(Math.round) as Metric;
  return `${VIEWER}?${new URLSearchParams({
    wkid: '25833',
    is3d: 'false',
    xmin: String(xmin),
    ymin: String(ymin),
    xmax: String(xmax),
    ymax: String(ymax),
  })}`;
};
