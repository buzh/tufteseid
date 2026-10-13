import {
  bboxFromMetric,
  bboxToMetric,
  MAX_SIDE_M,
  type Bbox,
  type Metric,
} from './bbox';
import { getWMSTileGrid } from './layers/wmsTileGrid';

// A boundary past MAX_SIDE_M is tiled into render boxes on the app's own tile
// grid (wmsTileGrid.ts), the same grid MapProxy's `tufteseid25833` and the cvat
// MBTiles stand on (mapproxy/mapproxy.yaml, vat-cache/build_tiles.py): change
// the ladder in one and the mosaic stops lining up with the tiles behind it.

// 338.5 m, the deepest level whose tile is under MAX_SIDE_M. Not a whole
// number of DEM cells at 1 m, unlike MAX_SIDE_M (`bbox.ts`): over a 1 m
// acquisition neighbouring tiles sample half a cell out of phase. The grid is
// shared with the tiles behind the mosaic and wins over the alignment.
export const TILE_Z = 15;

// Caps the render fan-out. The drag clamp is one tile short of this so the
// outward snap, which can add a tile per axis, still lands within it.
export const MOSAIC_MAX_TILES_PER_SIDE = 6;

type GridParams = { ox: number; oy: number; size: number };

let cached: GridParams | null | undefined;

// Null until the projection is registered (projInit.ts); callers fall back to a
// single free box, i.e. today's behaviour.
const gridParams = (): GridParams | null => {
  if (cached !== undefined) return cached;
  const grid = getWMSTileGrid('EPSG:25833');
  const origin = grid?.getOrigin(TILE_Z);
  const res = grid?.getResolution(TILE_Z);
  const px = grid?.getTileSize(TILE_Z);
  const side = typeof px === 'number' ? px : px?.[0];
  cached =
    origin && res && side
      ? { ox: origin[0], oy: origin[1], size: res * side }
      : null;
  return cached;
};

/** The z15 tile side in metres, or null before the projection is registered. */
export const tileSizeM = (): number | null => gridParams()?.size ?? null;

/** The largest boundary a reader may draw, as a side in metres. */
export const maxBoundaryMetres = (): number => {
  const size = tileSizeM();
  return size ? (MOSAIC_MAX_TILES_PER_SIDE - 1) * size : MAX_SIDE_M;
};

// An edge within this of a grid line counts as on it. The snap has to be
// idempotent: a snapped boundary is written as lon/lat and read back through
// `bboxFromMetric`, an approximate inverse, so it returns a hair off the line
// — and a bare floor would then push the edge out a whole tile on every
// release. Centimetres of drift, metres of slack, hundreds of metres of tile.
const SNAP_TOLERANCE_M = 0.5;

// Grid lines sit at origin + k·size on both axes; the north-west origin counts
// y downward, but oy − k·size is the same lattice as oy + m·size, so a plain
// floor/ceil snaps either axis.
const snapExtent = (m: Metric, g: GridParams): Metric => {
  const line = (v: number, origin: number, out: (k: number) => number) => {
    const k = (v - origin) / g.size;
    const on = Math.round(k);
    const index = Math.abs(k - on) * g.size <= SNAP_TOLERANCE_M ? on : out(k);
    return origin + index * g.size;
  };
  const below = (v: number, origin: number) => line(v, origin, Math.floor);
  const above = (v: number, origin: number) => line(v, origin, Math.ceil);
  return [
    below(m[0], g.ox),
    below(m[1], g.oy),
    above(m[2], g.ox),
    above(m[3], g.oy),
  ];
};

/** Expand a metric extent out to whole tiles, but only once it is past the
 *  cap — a box within the cap stays exactly as drawn. For
 *  `useRectangleAdjust`'s snap. */
export const snapBoundaryMetric = (m: Metric): Metric => {
  const side = Math.max(m[2] - m[0], m[3] - m[1]);
  const g = gridParams();
  return g && side > MAX_SIDE_M ? snapExtent(m, g) : m;
};

/** The render boxes a boundary covers. A boundary within the cap is one free box
 *  (today's single footprint); past it, the whole z15 tiles over the snapped
 *  boundary, row-major from the south-west. */
export const mosaicTiles = (bbox: Bbox): Bbox[] => {
  const metric = bboxToMetric(bbox);
  const side = Math.max(metric[2] - metric[0], metric[3] - metric[1]);
  const g = gridParams();
  if (!g || side <= MAX_SIDE_M) return [bbox];

  const snapped = snapExtent(metric, g);
  const cols = Math.round((snapped[2] - snapped[0]) / g.size);
  const rows = Math.round((snapped[3] - snapped[1]) / g.size);
  const tiles: Bbox[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = snapped[0] + c * g.size;
      const y = snapped[1] + r * g.size;
      tiles.push(bboxFromMetric([x, y, x + g.size, y + g.size]));
    }
  }
  return tiles;
};
