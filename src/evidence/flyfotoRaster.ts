// Norge i bilder ortofoto over a rectangle: the seamless mosaic or one
// acquisition, one stitcher. Same-origin through /wms/nib/* and /arcgis/nib/*
// → Caddy → wmscache → nib-proxy, which injects the anonymous token. Tiling and
// concurrency are `src/lidarExtract/stitch.ts`, the same as the LiDAR extract.
//
// The ground layer reads the mosaic through mapproxy (`/cache/flyfoto`), which
// is meta-tiled onto the app's own grid; a kept render asks the WMS directly,
// because the point of keeping is the acquisition's own resolution rather than
// the zoom level that happened to be up.

import { transformExtent } from 'ol/proj';

import {
  fetchAndPaint,
  planTiles,
  runWithConcurrency,
} from '../lidarExtract/stitch';
import type { Bbox } from '../map/bbox';
import {
  FLYFOTO_PROJECT_IMAGESERVER,
  flyfotoMosaicRule,
} from '../map/layers/config/backgroundLayers/flyfoto';
import type { FlyfotoProject } from '../map/layers/config/backgroundLayers/flyfotoProjects';
import { isUpstreamDown } from '../upstream/health';

const FLYFOTO_WMS_URL = '/wms/nib/ortofoto';
const FLYFOTO_LAYER = 'ortofoto';

// One acquisition is not a WMS operation: /wms/nib/ortofoto publishes only the
// merged layer. It is an ArcGIS ImageServer whose catalogue carries a
// prosjektnavn column, picked with a mosaicRule `where`.
const FLYFOTO_PROJECT_URL = `${FLYFOTO_PROJECT_IMAGESERVER}/exportImage`;

// A target, not a floor: `planTiles` scales down past its canvas cap, and the
// value reported back is the one actually achieved.
const TARGET_M_PER_PX = 0.2;

// NiB sits behind the same shed-and-retry public edge as Kartverket.
const MAX_CONCURRENT = 4;
const TILE_RETRIES = 3;
const RETRY_BASE_MS = 400;

export type FlyfotoRaster = {
  canvas: HTMLCanvasElement;
  metresPerPx: number;
  bbox25833: [number, number, number, number];
};

const projectUrl = (
  project: FlyfotoProject,
  bbox25833: [number, number, number, number],
  widthPx: number,
  heightPx: number,
): string => {
  const params = new URLSearchParams({
    f: 'image',
    bbox: bbox25833.join(','),
    bboxSR: '25833',
    imageSR: '25833',
    size: `${widthPx},${heightPx}`,
    // Plain jpg, not jpgpng: the stitch flattens onto opaque white below, and
    // `fetchAndPaint`'s uniform check drops the empty tiles.
    format: 'jpg',
    mosaicRule: flyfotoMosaicRule(project.id),
  });
  return `${FLYFOTO_PROJECT_URL}?${params.toString()}`;
};

const mosaicUrl = (
  bbox25833: [number, number, number, number],
  widthPx: number,
  heightPx: number,
): string => {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: FLYFOTO_LAYER,
    STYLES: '',
    CRS: 'EPSG:25833',
    BBOX: bbox25833.join(','),
    WIDTH: String(widthPx),
    HEIGHT: String(heightPx),
    FORMAT: 'image/jpeg',
  });
  return `${FLYFOTO_WMS_URL}?${params.toString()}`;
};

/**
 * Null when nothing painted and nothing failed: outside coverage, which is not
 * a fault and offers nothing to retry. A grab where every tile errored throws
 * instead. Same rule as `extractCanvas` and `fetchDem`.
 */
export const fetchFlyfotoRaster = async (
  bbox4326: Bbox,
  { project, signal }: { project?: FlyfotoProject; signal?: AbortSignal } = {},
): Promise<FlyfotoRaster | null> => {
  const bbox25833 = transformExtent(bbox4326, 'EPSG:4326', 'EPSG:25833') as [
    number,
    number,
    number,
    number,
  ];

  // Never finer than the acquisition holds — a 1937 flight upsampled is four
  // times the tiles for the same detail. The mosaic keeps the target.
  const metresPerPx = Math.max(TARGET_M_PER_PX, project?.metresPerPx ?? 0);
  const plan = planTiles(bbox25833, metresPerPx);
  if (plan.tiles.length === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = plan.widthPx;
  canvas.height = plan.heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // White base: a no-coverage gap would flatten to black in JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, plan.widthPx, plan.heightPx);

  let painted = 0;
  let failed = 0;
  await runWithConcurrency(plan.tiles, MAX_CONCURRENT, async (tile) => {
    const url = project
      ? projectUrl(project, tile.bbox25833, tile.w, tile.h)
      : mosaicUrl(tile.bbox25833, tile.w, tile.h);
    for (let attempt = 0; attempt < TILE_RETRIES; attempt++) {
      try {
        const result = await fetchAndPaint(
          url,
          ctx,
          tile.dx,
          tile.dy,
          tile.w,
          tile.h,
          signal,
        );
        if (result === 'painted') painted++;
        return;
      } catch (err) {
        if (signal?.aborted) return;
        // The breaker is already waiting; a local backoff would only add to it.
        if (isUpstreamDown(err)) {
          failed++;
          return;
        }
        if (attempt === TILE_RETRIES - 1) {
          failed++;
          return;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_BASE_MS * (attempt + 1)),
        );
      }
    }
  });

  if (signal?.aborted) throw new Error('flyfoto grab cancelled');
  // "Nothing came back" is not "nothing is there".
  if (painted === 0 && failed > 0) {
    throw new Error('every flyfoto tile request failed');
  }
  if (painted === 0) return null;

  return {
    canvas,
    metresPerPx: (bbox25833[2] - bbox25833[0]) / plan.widthPx,
    bbox25833,
  };
};
