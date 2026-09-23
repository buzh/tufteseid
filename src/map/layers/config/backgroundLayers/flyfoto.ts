import { transformExtent } from 'ol/proj';
import type { Bbox } from '../../../bbox';
import {
  fetchAndPaint,
  planTiles,
  runWithConcurrency,
} from '../../../../lidarExtract/stitch';
import { isUpstreamDown } from '../../../../upstream/health';
import type { FlyfotoProject } from './flyfotoProjects';

const FLYFOTO_WMS_URL = '/wms/nib/ortofoto';
const FLYFOTO_LAYER = 'ortofoto';

// The service root, without the operation: OL appends that itself.
export const FLYFOTO_PROJECT_IMAGESERVER =
  '/arcgis/nib/ortofoto_prosjekter/ImageServer';
const FLYFOTO_PROJECT_URL = `${FLYFOTO_PROJECT_IMAGESERVER}/exportImage`;

// SQL apostrophe escape; a few project names have one.
export const flyfotoProjectWhere = (projectId: string): string =>
  `prosjektnavn='${projectId.replace(/'/g, "''")}'`;

// `esriMosaicNone`: the default by-date method blends neighbouring projects in.
export const flyfotoMosaicRule = (projectId: string): string =>
  JSON.stringify({
    mosaicMethod: 'esriMosaicNone',
    where: flyfotoProjectWhere(projectId),
  });

// A target, not a floor: planTiles scales down past its canvas cap.
const TARGET_M_PER_PX = 0.2;
const MAX_CONCURRENT = 4;
const TILE_RETRIES = 3;

export type FlyfotoResult = {
  canvas: HTMLCanvasElement;
  widthPx: number;
  heightPx: number;
  metresPerPx: number;
  bbox25833: [number, number, number, number];
};

function buildProjectUrl(
  project: FlyfotoProject,
  bbox25833: [number, number, number, number],
  widthPx: number,
  heightPx: number,
): string {
  const params = new URLSearchParams({
    f: 'image',
    bbox: bbox25833.join(','),
    bboxSR: '25833',
    imageSR: '25833',
    size: `${widthPx},${heightPx}`,
    // Plain jpg, not jpgpng: the stitch flattens onto opaque white and
    // fetchAndPaint's uniform check drops the empty tiles.
    format: 'jpg',
    mosaicRule: flyfotoMosaicRule(project.id),
  });
  return `${FLYFOTO_PROJECT_URL}?${params.toString()}`;
}

function buildUrl(
  bbox25833: [number, number, number, number],
  widthPx: number,
  heightPx: number,
): string {
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
}

export type FlyfotoOptions = {
  project?: FlyfotoProject;
  signal?: AbortSignal;
};

// Null when nothing painted and nothing failed: outside coverage. A grab where
// every tile errored throws instead.
export async function fetchFlyfoto(
  bbox4326: Bbox,
  { project, signal }: FlyfotoOptions = {},
): Promise<FlyfotoResult | null> {
  const bbox25833 = transformExtent(bbox4326, 'EPSG:4326', 'EPSG:25833') as [
    number,
    number,
    number,
    number,
  ];

  // Never finer than the acquisition holds; the mosaic keeps the target.
  const metresPerPx = Math.max(TARGET_M_PER_PX, project?.metresPerPx ?? 0);
  const plan = planTiles(bbox25833, metresPerPx);
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
      ? buildProjectUrl(project, tile.bbox25833, tile.w, tile.h)
      : buildUrl(tile.bbox25833, tile.w, tile.h);
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
        // Refused by the breaker: nothing reached the network, so no backoff.
        if (isUpstreamDown(err)) {
          failed++;
          return;
        }
        if (attempt === TILE_RETRIES - 1) {
          failed++;
          return;
        }
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  });

  if (signal?.aborted) throw new Error('flyfoto grab cancelled');
  if (painted === 0 && failed > 0) {
    throw new Error('every flyfoto tile request failed');
  }
  if (painted === 0) return null;

  return {
    canvas,
    widthPx: plan.widthPx,
    heightPx: plan.heightPx,
    metresPerPx: (bbox25833[2] - bbox25833[0]) / plan.widthPx,
    bbox25833,
  };
}
