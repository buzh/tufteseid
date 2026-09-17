import { transformExtent } from 'ol/proj';
import { LocalityBbox } from '../api/localities';

// Read off what the producers can render, not what the map can frame: 1500 m
// is the largest rectangle whose 0.25 m LiDAR extract still fits the 40 Mpx
// store at native resolution, and below 50 m the provenance plate a download
// gets stamped with covers the image. Nothing migrates records, so a rectangle
// may exceed the band.
export const MIN_SIDE_M = 50;
export const MAX_SIDE_M = 1500;

// Measured in EPSG:25833, like every producer. The view projection is wrong by
// a factor of two at 60° N under EPSG:3857, and silently so.
const toMetric = (bbox: LocalityBbox): [number, number, number, number] =>
  transformExtent(bbox, 'EPSG:4326', 'EPSG:25833') as [
    number,
    number,
    number,
    number,
  ];

const toGeodetic = (extent: [number, number, number, number]): LocalityBbox =>
  transformExtent(extent, 'EPSG:25833', 'EPSG:4326') as LocalityBbox;

export const bboxSpanMetres = (bbox: LocalityBbox): [number, number] => {
  const [minX, minY, maxX, maxY] = toMetric(bbox);
  return [maxX - minX, maxY - minY];
};

/** Held still while resizing; `'centre'` grows about the middle. */
export type BboxAnchor = 'centre' | [lon: number, lat: number];

/**
 * Holds `anchor` still. `ceiling` is a ratchet for records already over
 * `MAX_SIDE_M`: the clamp takes whichever is larger, the band or the rectangle
 * as the gesture found it, so nudging a legacy corner cannot destroy it.
 */
export const clampBboxSize = (
  bbox: LocalityBbox,
  anchor: BboxAnchor,
  ceiling?: LocalityBbox,
): LocalityBbox => {
  const [minX, minY, maxX, maxY] = toMetric(bbox);
  const width = maxX - minX;
  const height = maxY - minY;

  const headroom = ceiling ? bboxSpanMetres(ceiling) : [0, 0];
  const maxWidth = Math.max(MAX_SIDE_M, headroom[0]);
  const maxHeight = Math.max(MAX_SIDE_M, headroom[1]);

  const nextWidth = Math.min(Math.max(width, MIN_SIDE_M), maxWidth);
  const nextHeight = Math.min(Math.max(height, MIN_SIDE_M), maxHeight);
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

/** The ceiling alone: the one caller only grows, and testing the floor would
 * refuse to grow a sub-50 m legacy record towards the band. */
export const bboxExceedsMax = (bbox: LocalityBbox): boolean => {
  const [width, height] = bboxSpanMetres(bbox);
  return width > MAX_SIDE_M || height > MAX_SIDE_M;
};
