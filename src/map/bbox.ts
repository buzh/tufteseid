import { boundingExtent, containsExtent } from 'ol/extent';
import type Map from 'ol/Map';
import { transform, transformExtent } from 'ol/proj';

export type Bbox = [
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
];

export const MAX_SIDE_M = 500;

export const MIN_SIDE_M = 50;

export type Metric = [minX: number, minY: number, maxX: number, maxY: number];

export const bboxToMetric = (bbox: Bbox): Metric =>
  transformExtent(bbox, 'EPSG:4326', 'EPSG:25833') as Metric;

const carry = (extent: Metric): Bbox =>
  transformExtent(extent, 'EPSG:25833', 'EPSG:4326') as Bbox;

export const bboxFromMetric = (extent: Metric): Bbox => {
  const [minX, minY, maxX, maxY] = extent;
  const back = bboxToMetric(carry(extent));
  const gainX = (back[2] - back[0]) / (maxX - minX);
  const gainY = (back[3] - back[1]) / (maxY - minY);
  if (!(gainX > 0) || !(gainY > 0)) return carry(extent);
  const halfX = (maxX - minX) / gainX / 2;
  const halfY = (maxY - minY) / gainY / 2;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return carry([cx - halfX, cy - halfY, cx + halfX, cy + halfY]);
};

export const bboxWidthMetres = (bbox: Bbox): number => {
  const [minX, , maxX] = bboxToMetric(bbox);
  return maxX - minX;
};

export const bboxEquals = (a: Bbox, b: Bbox): boolean =>
  a.every((value, index) => value === b[index]);

export const bboxOverlaps = (a: Bbox, b: Bbox): boolean =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

export const squareBboxWithin = (bbox: Bbox): Bbox => {
  const [minX, minY, maxX, maxY] = bboxToMetric(bbox);
  const side = Math.min(maxX - minX, maxY - minY, MAX_SIDE_M);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return bboxFromMetric([
    cx - side / 2,
    cy - side / 2,
    cx + side / 2,
    cy + side / 2,
  ]);
};

const metricSquare = (cx: number, cy: number, sideMetres: number): Bbox => {
  const half = Math.min(Math.max(sideMetres, MIN_SIDE_M), MAX_SIDE_M) / 2;
  return bboxFromMetric([cx - half, cy - half, cx + half, cy + half]);
};

export const squareBboxAround = (
  point: [lon: number, lat: number],
  sideMetres: number,
): Bbox => {
  const [cx, cy] = transform(point, 'EPSG:4326', 'EPSG:25833');
  return metricSquare(cx, cy, sideMetres);
};

export const squareBboxCovering = (bbox: Bbox): Bbox => {
  const [minX, minY, maxX, maxY] = bboxToMetric(bbox);
  return metricSquare(
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    Math.max(maxX - minX, maxY - minY),
  );
};

const VIEW_CELLS = 3;

export const middleCellSquare = (map: Map): Bbox | null => {
  const size = map.getSize();
  if (!size) return null;
  const view = map.getView();
  const extent = transformExtent(
    view.calculateExtent(size),
    view.getProjection(),
    'EPSG:4326',
  ) as Bbox;
  const [minX, minY, maxX, maxY] = bboxToMetric(extent);
  return metricSquare(
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    Math.min(maxX - minX, maxY - minY) / VIEW_CELLS,
  );
};

const INSET_FRACTION = 0.08;
const INSET_MIN_PX = 48;
const MIN_SIDE_PX = 64;

export const viewportBbox = (map: Map): Bbox | null => {
  const size = map.getSize();
  if (!size) return null;
  const [width, height] = size;

  const insetX = Math.max(INSET_MIN_PX, Math.round(width * INSET_FRACTION));
  const insetY = Math.max(INSET_MIN_PX, Math.round(height * INSET_FRACTION));

  const left = insetX;
  const right = width - insetX;
  const top = insetY;
  const bottom = height - insetY;
  if (right - left < MIN_SIDE_PX || bottom - top < MIN_SIDE_PX) return null;

  const topLeft = map.getCoordinateFromPixel([left, top]);
  const bottomRight = map.getCoordinateFromPixel([right, bottom]);
  if (!topLeft || !bottomRight) return null;

  const projection = map.getView().getProjection();
  const extent = boundingExtent([topLeft, bottomRight]);
  return transformExtent(extent, projection, 'EPSG:4326') as Bbox;
};

const FIT_PADDING_PX = 48;

export const bringBboxIntoView = (map: Map, bbox: Bbox) => {
  const size = map.getSize();
  if (!size) return;
  const visible = viewportBbox(map);
  if (visible && containsExtent(visible, bbox)) return;
  const view = map.getView();
  view.fit(transformExtent(bbox, 'EPSG:4326', view.getProjection()), {
    size,
    padding: [FIT_PADDING_PX, FIT_PADDING_PX, FIT_PADDING_PX, FIT_PADDING_PX],
    maxZoom: view.getZoom(),
    duration: 300,
  });
};
