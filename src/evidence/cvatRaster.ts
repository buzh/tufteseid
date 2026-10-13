

import type TileGrid from 'ol/tilegrid/TileGrid';

import {
  MAX_CANVAS_PX_PER_SIDE,
  runWithConcurrency,
} from '../lidarExtract/stitch';
import { bboxToMetric, type Bbox, type Metric } from '../map/bbox';
import type { CvatAcquisition } from '../map/layers/config/backgroundLayers/cvatGround';
import { getWMSTileGrid } from '../map/layers/wmsTileGrid';
import type { Raster } from './fit';

const MAX_CONCURRENT = 6;

const fetchTile = async (
  url: string,
  signal?: AbortSignal,
): Promise<ImageBitmap | null> => {
  const res = await fetch(url, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`cvat tile HTTP ${res.status}`);
  return createImageBitmap(await res.blob());
};

const levelFor = (
  grid: TileGrid,
  acquisition: CvatAcquisition,
  bbox25833: Metric,
): number => {
  const side = Math.max(
    bbox25833[2] - bbox25833[0],
    bbox25833[3] - bbox25833[1],
  );
  for (let z = acquisition.maxZoom; z > acquisition.minZoom; z--) {
    if (side / grid.getResolution(z) <= MAX_CANVAS_PX_PER_SIDE) return z;
  }
  return acquisition.minZoom;
};

export const fetchCvatRaster = async (
  bbox4326: Bbox,
  acquisition: CvatAcquisition,
  signal?: AbortSignal,
): Promise<Raster | null> => {
  const grid = getWMSTileGrid('EPSG:25833');
  if (!grid) return null;

  const bbox25833 = bboxToMetric(bbox4326);
  const z = levelFor(grid, acquisition, bbox25833);
  const res = grid.getResolution(z);
  const [originX, originY] = grid.getOrigin(z);
  const size = grid.getTileSize(z);
  const tilePx = typeof size === 'number' ? size : size[0];

  const left = Math.floor((bbox25833[0] - originX) / res);
  const right = Math.ceil((bbox25833[2] - originX) / res);
  const top = Math.floor((originY - bbox25833[3]) / res);
  const bottom = Math.ceil((originY - bbox25833[1]) / res);
  if (right <= left || bottom <= top) return null;

  const canvas = document.createElement('canvas');
  canvas.width = right - left;
  canvas.height = bottom - top;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const tiles: Array<{ tx: number; ty: number }> = [];
  for (
    let ty = Math.floor(top / tilePx);
    ty <= Math.floor((bottom - 1) / tilePx);
    ty++
  ) {
    for (
      let tx = Math.floor(left / tilePx);
      tx <= Math.floor((right - 1) / tilePx);
      tx++
    ) {
      tiles.push({ tx, ty });
    }
  }

  let painted = 0;
  let failed = 0;
  await runWithConcurrency(tiles, MAX_CONCURRENT, async ({ tx, ty }) => {
    try {
      const bitmap = await fetchTile(
        `/cvat/${acquisition.path}/${z}/${tx}/${ty}.webp`,
        signal,
      );
      if (!bitmap) return;
      try {
        ctx.drawImage(bitmap, tx * tilePx - left, ty * tilePx - top);
      } finally {
        bitmap.close();
      }
      painted++;
    } catch {
      if (!signal?.aborted) failed++;
    }
  });

  if (signal?.aborted) throw new Error('cvat grab cancelled');

  if (painted === 0 && failed > 0)
    throw new Error('every cvat tile request failed');
  if (painted === 0) return null;

  return {
    canvas,
    metresPerPx: res,
    bbox25833: [
      originX + left * res,
      originY - bottom * res,
      originX + right * res,
      originY - top * res,
    ],
  };
};
