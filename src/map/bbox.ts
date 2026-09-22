// A geographic rectangle, the largest one the raster producers will render, and
// the rectangle the visible map currently frames.

import { boundingExtent } from 'ol/extent';
import type Map from 'ol/Map';
import { transformExtent } from 'ol/proj';

/** EPSG:4326, the interchange form every producer in here is handed. */
export type Bbox = [
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
];

// Read off what the producers can render, not what the map can frame. The
// ceiling is set by terrain analysis, the most expensive reader of a rectangle:
// `MAX_DEM_PX_PER_SIDE` in `src/terrain/dem.ts` is derived as MAX_SIDE_M plus
// its horizon margin at the finest elevation data that exists (0.25 m), so a
// DEM over a rectangle at the ceiling is never resampled.
//
// 500 m is a whole number of cells at every resolution the per-project mosaics
// publish — 2000 px at 0.25 m, 1000 at 0.5, 500 at 1 — so the grid is exact
// rather than rounded, and the margin brings the assembled square to 2192 px,
// which is 19 MB of float and 4.8 Mpx of arithmetic per visualization. The
// previous kilometre was four times that on both counts for a rectangle the
// reader could not see the edges of on any ordinary screen.
export const MAX_SIDE_M = 500;

// The smallest square a hand is allowed to drag one down to. Not a producer
// limit — it is the point below which an analysis stops being one: 50 m is 200
// px of the finest grid that exists, and a corner handle pulled past its
// opposite one would otherwise leave a rectangle with no area and a render with
// no pixels. `squareBboxWithin` deliberately has no floor for the opposite
// reason, spelled out on it: nothing there is aiming at a size, so a minimum is
// the one rule that could push the square back off the screen.
export const MIN_SIDE_M = 50;

// Measured in EPSG:25833, like every producer. The view projection is wrong by
// a factor of two at 60° N under EPSG:3857, and silently so.
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
 * How wide the rectangle is on the ground, for a readout. Width and not the
 * mean of the two sides: a square built in EPSG:25833 and carried here as a
 * lon/lat extent comes back a metre or two taller than it went out, because a
 * projected square's north edge is a curve in latitude and the extent takes its
 * highest point. The width is the number the square was built to.
 */
export const bboxWidthMetres = (bbox: Bbox): number => {
  const [minX, , maxX] = bboxToMetric(bbox);
  return maxX - minX;
};

/** Do the two lon/lat rectangles share any ground at all. */
export const bboxOverlaps = (a: Bbox, b: Bbox): boolean =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/**
 * The largest square a producer will render inside `bbox`: the shorter of its
 * two sides, capped at `MAX_SIDE_M`, held about the centre.
 *
 * Square because the ceiling is a square. Clamping each axis on its own keeps
 * the screen's aspect and hands a reader who asked for the cap a 500 × 280 m
 * analysis on a wide window, which is neither what the control promises nor a
 * shape two renders can be compared in.
 *
 * *Inside*, because the caller passes the visible map: an analysis is a
 * rectangle held still while the reader pans, and one that started off the
 * edges of the screen is one whose edges they never saw. That is also why there
 * is no floor — a minimum side is the one rule that could push the square back
 * out past the edge, and on a screen showing less ground than the smallest
 * analysis worth making, the screen is the honest answer.
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
 * The visible map, inset from its own edges. Pixel corners rather than
 * `View#calculateExtent` so that a future UI can inset asymmetrically for
 * chrome without changing the callers; rotation is off, so two corners
 * describe the rectangle.
 *
 * No ceiling: callers cap the result themselves, so zooming right out gives a
 * `MAX_SIDE_M` square rather than a refusal.
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
