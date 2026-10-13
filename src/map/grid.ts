import {
  bboxFromMetric,
  bboxToMetric,
  MAX_SIDE_M,
  type Bbox,
  type Metric,
} from './bbox';
import { getWMSTileGrid } from './layers/wmsTileGrid';

export const TILE_Z = 15;

export const MOSAIC_MAX_TILES_PER_SIDE = 6;

type GridParams = { ox: number; oy: number; size: number };

let cached: GridParams | null | undefined;

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

export const tileSizeM = (): number | null => gridParams()?.size ?? null;

export const maxBoundaryMetres = (): number => {
  const size = tileSizeM();
  return size ? (MOSAIC_MAX_TILES_PER_SIDE - 1) * size : MAX_SIDE_M;
};

const SNAP_TOLERANCE_M = 0.5;

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

export const snapBoundaryMetric = (m: Metric): Metric => {
  const side = Math.max(m[2] - m[0], m[3] - m[1]);
  const g = gridParams();
  return g && side > MAX_SIDE_M ? snapExtent(m, g) : m;
};

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
