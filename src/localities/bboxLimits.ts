import { transformExtent } from 'ol/proj';
import { LocalityBbox } from '../api/localities';

/*
 * How big a lokalitet is allowed to be, and why those two numbers.
 *
 * Both are read off what the producers can actually render, not off what the
 * map will let you frame — the guard this replaced was `MAX_SPAN_M = 25_000`,
 * derived from "minZoom is 3, so the viewport can be most of Norway", which is
 * a statement about the view rather than about anything downstream.
 *
 * **1500 m** is the largest rectangle whose finest LiDAR extract still fits the
 * store at its own resolution. `renderFigureBlob` caps a figure at
 * `MAX_STORED_PIXELS` = 40 Mpx (src/figure/figure.ts), and √40 Mpx × 0.25 m
 * (the per-project mosaics' native cell) is 1581 m. Past that every kept
 * extract is quietly coarser than the source it names — and the costs climb
 * with the square: 1500 m is a 6000² canvas and nine GetMap tiles per style,
 * so twenty-seven for a starter set; 3000 m is 12000², 576 MB and thirty-six.
 *
 * **50 m** is where a figure's caption panel stops being taller than the image
 * it captions (200 px of extract against ~160 px of caption). Below that the
 * thing being framed is a single object, and a single object is a *funn*.
 *
 * Nothing migrates existing records, so a rectangle may legitimately be larger
 * than the band — see `clampBboxSize`.
 */
export const MIN_SIDE_M = 50;
export const MAX_SIDE_M = 1500;

/*
 * Measured in EPSG:25833, not in the view projection.
 *
 * Two reasons, and the first is a bug the old guard had: the view can be
 * `EPSG:3857` (it is URL-selectable — src/map/projections/types.ts), where
 * `getMetersPerUnit()` answers 1 while a metre at 60° N is really half of one,
 * so a span checked there is out by a factor of two. The second is that 25833
 * is the projection every producer renders in — `extractCanvas`, `dem.ts` and
 * `captureLocalityScreenshot` all transform to it first — so a rectangle
 * bounded there is the raster that actually gets built, bounded.
 */
const toMetric = (bbox: LocalityBbox): [number, number, number, number] =>
  transformExtent(bbox, 'EPSG:4326', 'EPSG:25833') as [
    number,
    number,
    number,
    number,
  ];

const toGeodetic = (extent: [number, number, number, number]): LocalityBbox =>
  transformExtent(extent, 'EPSG:25833', 'EPSG:4326') as LocalityBbox;

/** Width and height on the ground, in metres. */
export const bboxSpanMetres = (bbox: LocalityBbox): [number, number] => {
  const [minX, minY, maxX, maxY] = toMetric(bbox);
  return [maxX - minX, maxY - minY];
};

/**
 * The corner that stays put while the rectangle is resized, in EPSG:4326 —
 * i.e. the one opposite whichever corner was dragged. `'centre'` grows and
 * shrinks about the middle instead, which is what seeding from the viewport
 * wants.
 */
export type BboxAnchor = 'centre' | [lon: number, lat: number];

/**
 * Bring a rectangle inside the band, holding `anchor` still.
 *
 * `ceiling` is the ratchet, and it is the reason this takes a third argument
 * at all: **an existing lokalitet may already be larger than `MAX_SIDE_M`**,
 * because nothing migrates them and the old guard allowed 25 km. Snapping such
 * a record to 1500 m the moment somebody nudged one of its corners would
 * destroy it. So a gesture is clamped to whichever is larger, the band or the
 * rectangle as it stood when the gesture started: you may always shrink, you
 * may never grow past the band, and a rectangle already past it can only come
 * down — each gesture leaving the next one a lower ceiling.
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

  // Which corner is being held: whichever of the two the anchor is nearer to
  // on each axis. Comparing rather than matching exactly, because the anchor
  // arrives as a coordinate that has been through two reprojections.
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

/**
 * Is this rectangle over the ceiling on either axis?
 *
 * The ceiling alone, deliberately — the floor has no case that needs asking
 * about. A rectangle only ever reaches the floor by being dragged, and a drag
 * is clamped rather than refused; the one caller here (`growToFitDrawing`)
 * unions an existing rectangle with a drawing, which can only make it bigger.
 * Testing the floor too would refuse to grow a sub-50 m legacy record towards
 * the band, which is the opposite of what the band is for.
 */
export const bboxExceedsMax = (bbox: LocalityBbox): boolean => {
  const [width, height] = bboxSpanMetres(bbox);
  return width > MAX_SIDE_M || height > MAX_SIDE_M;
};
