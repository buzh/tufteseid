import { boundingExtent } from 'ol/extent';
import type Map from 'ol/Map';
import { transformExtent } from 'ol/proj';

/** EPSG:4326. */
export type Bbox = [
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
];

// A whole number of DEM cells at every per-project resolution (2000 px at
// 0.25 m, 1000 at 0.5, 500 at 1). `MAX_DEM_PX_PER_SIDE` in `src/terrain/dem.ts`
// is derived from this plus its horizon margin.
export const MAX_SIDE_M = 500;

// Floor for a hand-dragged square; `squareBboxWithin` has none.
export const MIN_SIDE_M = 50;

// EPSG:25833 metres, like every producer. EPSG:3857 is out by a factor of two
// at 60° N, silently.
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
 * Ground width in metres. Width and not the mean of the two sides: a square
 * built in EPSG:25833 and carried back as a lon/lat extent measures a metre or
 * two taller than it went out.
 */
export const bboxWidthMetres = (bbox: Bbox): number => {
  const [minX, , maxX] = bboxToMetric(bbox);
  return maxX - minX;
};

export const bboxOverlaps = (a: Bbox, b: Bbox): boolean =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/**
 * The largest square inside `bbox`: the shorter of its two sides, capped at
 * `MAX_SIDE_M`, held about the centre. No floor — a minimum side could push the
 * square back out past the edge of the caller's viewport.
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

// At ≥8%, enough that transformExtent's corner-only reprojection cannot clip.
const INSET_FRACTION = 0.08;
const INSET_MIN_PX = 48;
const MIN_SIDE_PX = 64;

/**
 * The visible map, inset from its own edges. Assumes no rotation: two pixel
 * corners describe the rectangle. No ceiling — callers cap the result.
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
