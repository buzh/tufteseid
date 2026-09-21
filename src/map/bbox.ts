// A geographic rectangle, the band the raster producers can render one in, and
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
// DEM over a rectangle in the band is never resampled.
const MIN_SIDE_M = 50;
export const MAX_SIDE_M = 1000;

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

/** Held still while resizing; `'centre'` grows about the middle. */
export type BboxAnchor = 'centre' | [lon: number, lat: number];

/**
 * Holds `anchor` still. No ratchet for a rectangle already over the band: the
 * band is what makes the DEM grid exact, so a rectangle outside it is brought
 * in by the first gesture that touches it rather than carried.
 */
export const clampBboxSize = (bbox: Bbox, anchor: BboxAnchor): Bbox => {
  const [minX, minY, maxX, maxY] = toMetric(bbox);
  const width = maxX - minX;
  const height = maxY - minY;

  const nextWidth = Math.min(Math.max(width, MIN_SIDE_M), MAX_SIDE_M);
  const nextHeight = Math.min(Math.max(height, MIN_SIDE_M), MAX_SIDE_M);
  if (nextWidth === width && nextHeight === height) return bbox;

  if (anchor === 'centre') {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return toGeodetic([
      cx - nextWidth / 2,
      cy - nextHeight / 2,
      cx + nextWidth / 2,
      cy + nextHeight / 2,
    ]);
  }

  // Nearest rather than exact: the anchor has been through two reprojections.
  const [anchorX, anchorY] = transformExtent(
    [anchor[0], anchor[1], anchor[0], anchor[1]],
    'EPSG:4326',
    'EPSG:25833',
  );
  const holdWest = Math.abs(anchorX - minX) <= Math.abs(anchorX - maxX);
  const holdSouth = Math.abs(anchorY - minY) <= Math.abs(anchorY - maxY);

  const west = holdWest ? minX : maxX - nextWidth;
  const south = holdSouth ? minY : maxY - nextHeight;
  return toGeodetic([west, south, west + nextWidth, south + nextHeight]);
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
 * No ceiling: callers clamp the result into the band, so zooming right out
 * gives a `MAX_SIDE_M` rectangle rather than a refusal.
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
