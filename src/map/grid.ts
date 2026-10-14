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
  return size ? MOSAIC_MAX_TILES_PER_SIDE * size : MAX_SIDE_M;
};

const snapExtent = (m: Metric, g: GridParams): Metric => {
  const line = (v: number, origin: number) =>
    origin + Math.round((v - origin) / g.size) * g.size;
  const cell = (v: number, origin: number) =>
    origin + Math.floor((v - origin) / g.size) * g.size;
  const span = (
    low: number,
    high: number,
    origin: number,
    least: number,
  ): [number, number] => {
    const from = line(low, origin);
    const to = line(high, origin);
    if (to - from >= least * g.size) return [from, to];
    const reach = least * g.size;
    const start = cell((low + high - reach) / 2, origin);
    return [start, start + reach];
  };
  const leastTiles = (side: number) =>
    side > MAX_SIDE_M ? Math.max(2, Math.ceil(MAX_SIDE_M / g.size)) : 1;
  const [minX, maxX] = span(m[0], m[2], g.ox, leastTiles(m[2] - m[0]));
  const [minY, maxY] = span(m[1], m[3], g.oy, leastTiles(m[3] - m[1]));
  return [minX, minY, maxX, maxY];
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
