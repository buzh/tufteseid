// Same-origin through /wms/nib/* and /arcgis/nib/* → Caddy → wmscache →
// nib-proxy, which injects the anonymous token.
//
// Not mapproxy's /cache/flyfoto, which is what the ground layer reads: that is
// meta-tiled onto the app's own grid, and a kept render wants the acquisition's
// own resolution rather than whatever zoom level happened to be up.

import {
  fetchAndPaint,
  planTiles,
  runWithConcurrency,
} from '../lidarExtract/stitch';
import { bboxToMetric, type Bbox, type Metric } from '../map/bbox';
import {
  FLYFOTO_PROJECT_IMAGESERVER,
  flyfotoMosaicRule,
} from '../map/layers/config/backgroundLayers/flyfoto';
import type { FlyfotoProject } from '../map/layers/config/backgroundLayers/flyfotoProjects';
import { isUpstreamDown } from '../upstream/health';
import { MAX_STORED_PIXELS, type Raster } from './fit';

const FLYFOTO_WMS_URL = '/wms/nib/ortofoto';
const FLYFOTO_LAYER = 'ortofoto';

// One acquisition is not a WMS operation: /wms/nib/ortofoto publishes only the
// merged layer. It is an ArcGIS ImageServer whose catalogue carries a
// prosjektnavn column, picked with a mosaicRule `where`.
const FLYFOTO_PROJECT_URL = `${FLYFOTO_PROJECT_IMAGESERVER}/exportImage`;

// The seamless mosaic carries no pixel size of its own, so this stands in for
// one. An acquisition uses its own figure, coarser or finer.
const MOSAIC_M_PER_PX = 0.2;

// NiB sits behind the same shed-and-retry public edge as Kartverket.
const MAX_CONCURRENT = 4;
const TILE_RETRIES = 3;
const RETRY_BASE_MS = 400;

// Finest worth asking for: `fitImageBlob` scales anything past the store's
// pixel budget back down again, so tiles beyond it are fetched to be thrown
// away. A 500 m footprint bottoms out here at 0.08 m/px.
const storeLimit = (bbox25833: Metric): number =>
  Math.sqrt(
    ((bbox25833[2] - bbox25833[0]) * (bbox25833[3] - bbox25833[1])) /
      MAX_STORED_PIXELS,
  );

const projectUrl = (
  project: FlyfotoProject,
  bbox25833: Metric,
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
  bbox25833: Metric,
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
): Promise<Raster | null> => {
  const bbox25833 = bboxToMetric(bbox4326);

  // The acquisition's own grid: never upsampled, because a 1937 flight
  // stretched is four times the tiles for the same detail, and never
  // downsampled either, because that resolution is the point of keeping.
  const native = project?.metresPerPx ?? 0;
  const metresPerPx = Math.max(
    native > 0 ? native : MOSAIC_M_PER_PX,
    storeLimit(bbox25833),
  );
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
