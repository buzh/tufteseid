import { boundingExtent, containsExtent } from 'ol/extent';
import type Map from 'ol/Map';
import { transform, transformExtent } from 'ol/proj';

/** EPSG:4326. */
export type Bbox = [
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
];

// A whole number of DEM cells at every per-project resolution (2000 px at
// 0.25 m, 1000 at 0.5, 500 at 1).
export const MAX_SIDE_M = 500;

// Floor for a hand-dragged square.
export const MIN_SIDE_M = 50;

// EPSG:25833 metres. EPSG:3857 metres are out by a factor of two at 60° N.
export const bboxToMetric = (bbox: Bbox): [number, number, number, number] =>
  transformExtent(bbox, 'EPSG:4326', 'EPSG:25833') as [
    number,
    number,
    number,
    number,
  ];

export const bboxFromMetric = (
  extent: [number, number, number, number],
): Bbox => transformExtent(extent, 'EPSG:25833', 'EPSG:4326') as Bbox;

/**
 * Ground width in metres. The x extent, not the mean of the two sides: a square
 * built in EPSG:25833 measures a metre or two taller once carried to lon/lat.
 */
export const bboxWidthMetres = (bbox: Bbox): number => {
  const [minX, , maxX] = bboxToMetric(bbox);
  return maxX - minX;
};

export const bboxOverlaps = (a: Bbox, b: Bbox): boolean =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/**
 * The largest square inside `bbox`, capped at `MAX_SIDE_M`, about its centre.
 * No floor: a minimum side could push the square outside the caller's viewport.
 */
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

/** Square in EPSG:25833, clamped to `MIN_SIDE_M`…`MAX_SIDE_M`. */
export const squareBboxAround = (
  point: [lon: number, lat: number],
  sideMetres: number,
): Bbox => {
  const [cx, cy] = transform(point, 'EPSG:4326', 'EPSG:25833');
  return metricSquare(cx, cy, sideMetres);
};

/**
 * The smallest square holding `bbox`, about its centre. Past `MAX_SIDE_M` the
 * cap wins and the square holds the middle of it instead.
 */
export const squareBboxCovering = (bbox: Bbox): Bbox => {
  const [minX, minY, maxX, maxY] = bboxToMetric(bbox);
  return metricSquare(
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    Math.max(maxX - minX, maxY - minY),
  );
};

// The centre cell of a 3×3 over the viewport: a square the reader reads as a
// piece of what is on screen rather than as the whole of it.
const VIEW_CELLS = 3;

/**
 * A square on the middle of what the map shows, a third of its shorter side
 * across. Null before first layout.
 */
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

// ≥8%, enough that transformExtent's corner-only reprojection cannot clip.
const INSET_FRACTION = 0.08;
const INSET_MIN_PX = 48;
const MIN_SIDE_PX = 64;

/**
 * The visible map, inset from its own edges and uncapped. Assumes no rotation:
 * two pixel corners describe the rectangle.
 */
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

// Room left around a rectangle the view had to be moved for.
const FIT_PADDING_PX = 48;

/**
 * Pan or zoom out until the rectangle is on screen — never in, so a reader who
 * can already see it keeps the view they chose. A footprint is capped at
 * `MAX_SIDE_M`, so the furthest this ever goes out is a level or two.
 */
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
