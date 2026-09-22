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

// Measured in EPSG:25833, like every producer. The view projection is wrong by
// a factor of two at 60° N under EPSG:3857, and silently so.
const toMetric = (bbox: Bbox): [number, number, number, number] =>
  transformExtent(bbox, 'EPSG:4326', 'EPSG:25833') as [
    number,
    number,
    number,
    number,
  ];

const toGeodetic = (extent: [number, number, number, number]): Bbox =>
  transformExtent(extent, 'EPSG:25833', 'EPSG:4326') as Bbox;

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
  const [minX, minY, maxX, maxY] = toMetric(bbox);
  const side = Math.min(maxX - minX, maxY - minY, MAX_SIDE_M);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return toGeodetic([
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
