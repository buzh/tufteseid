// The cached ground as pixels over one rectangle: the same tiles
// `cvatGround.ts` puts on the map, read back off /cvat/* and stitched.
//
// Not a WMS grab. The store answers whole tiles on the app's own grid
// (`wmsTileGrid.ts`) and nothing else, so the level is chosen and the edges
// cropped here rather than asked for.

import type TileGrid from 'ol/tilegrid/TileGrid';

import {
  MAX_CANVAS_PX_PER_SIDE,
  runWithConcurrency,
} from '../lidarExtract/stitch';
import { bboxToMetric, type Bbox, type Metric } from '../map/bbox';
import type { CvatAcquisition } from '../map/layers/config/backgroundLayers/cvatGround';
import { getWMSTileGrid } from '../map/layers/wmsTileGrid';

// A hit is a SELECT against a bind-mounted SQLite file on the same host, so the
// limit is here to bound the canvas work rather than to spare an upstream.
const MAX_CONCURRENT = 6;

type CvatRaster = {
  canvas: HTMLCanvasElement;
  metresPerPx: number;
  bbox25833: Metric;
};

/** Null for a tile the pipeline has not written: 404 is how the acquisition's
 *  footprint is drawn (`cvat-tiles/server.mjs`), not a fault. A store it cannot
 *  open answers 503, which is. */
const fetchTile = async (
  url: string,
  signal?: AbortSignal,
): Promise<ImageBitmap | null> => {
  const res = await fetch(url, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`cvat tile HTTP ${res.status}`);
  return createImageBitmap(await res.blob());
};

/** The deepest level the store holds whose canvas stays inside the stitch's
 *  cap. A spot's footprint is 500 m at most and z16 is 0.331 m/px, so this is
 *  the acquisition's own resolution for anything the card can ask for. */
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

/**
 * Null when nothing painted and nothing failed: the rectangle is off this
 * flight, which is an answer about the ground rather than a fault. A grab where
 * every tile errored throws instead. Same rule as `extractCanvas`,
 * `fetchFlyfotoRaster` and `fetchDem`.
 */
export const fetchCvatRaster = async (
  bbox4326: Bbox,
  acquisition: CvatAcquisition,
  signal?: AbortSignal,
): Promise<CvatRaster | null> => {
  const grid = getWMSTileGrid('EPSG:25833');
  if (!grid) return null;

  const bbox25833 = bboxToMetric(bbox4326);
  const z = levelFor(grid, acquisition, bbox25833);
  const res = grid.getResolution(z);
  const [originX, originY] = grid.getOrigin(z);
  const size = grid.getTileSize(z);
  const tilePx = typeof size === 'number' ? size : size[0];

  // Grid pixels at this level, snapped outward. Every source pixel is then
  // drawn 1:1 — the store stops at z15 or z16 and resampling it to land exactly
  // on the footprint would soften the one thing the render is for.
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
  // "Nothing came back" is not "nothing is there".
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
