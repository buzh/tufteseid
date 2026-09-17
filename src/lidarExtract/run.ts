// One (source × style) stitched at that source's native ground resolution.
// Zero painted tiles means the rectangle is outside its coverage.

import { LidarSource, nativeResolutionMetersPerPx } from './sources';
import {
  buildGetMapUrl,
  fetchAndPaint,
  planTiles,
  runWithConcurrency,
} from './stitch';

// Past ~4, wmscache starts answering 502 under normal map-browsing load.
const MAX_CONCURRENT_TILES = 4;

// Transient 5xx during bursts is common upstream.
const TILE_MAX_RETRIES = 3;
const TILE_RETRY_BASE_MS = 500;

type TileJob = {
  url: string;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  ctx: CanvasRenderingContext2D;
};

// 'aborted' is not counted: the run it belonged to is gone.
type TileOutcomeKind = 'painted' | 'blank' | 'failed' | 'aborted';

async function paintTile(
  item: TileJob,
  signal: AbortSignal,
): Promise<{ kind: TileOutcomeKind; errorMessage?: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= TILE_MAX_RETRIES; attempt++) {
    if (signal.aborted) return { kind: 'aborted' };
    try {
      const result = await fetchAndPaint(
        item.url,
        item.ctx,
        item.dx,
        item.dy,
        item.dw,
        item.dh,
        signal,
      );
      return { kind: result === 'blank' ? 'blank' : 'painted' };
    } catch (err) {
      lastErr = err;
      if (signal.aborted) return { kind: 'aborted' };
      if (attempt < TILE_MAX_RETRIES) {
        await sleep(TILE_RETRY_BASE_MS * 2 ** attempt, signal);
      }
    }
  }
  return {
    kind: 'failed',
    errorMessage: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
}

export type ExtractedCanvas = {
  canvas: HTMLCanvasElement;
  metresPerPx: number;
  widthPx: number;
  heightPx: number;
  bbox25833: [number, number, number, number];
};

/**
 * `null` when nothing painted and nothing failed — no coverage; a run where
 * every tile errored throws instead. Cancellation is the caller's `signal`,
 * never a module-level one, so a background grab cannot cancel a foreground.
 */
export async function extractCanvas(
  bbox25833: [number, number, number, number],
  source: LidarSource,
  style: string,
  signal?: AbortSignal,
): Promise<ExtractedCanvas | null> {
  const metresPerPx = nativeResolutionMetersPerPx(source);
  const plan = planTiles(bbox25833, metresPerPx);
  if (plan.tiles.length === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = plan.widthPx;
  canvas.height = plan.heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const ac = new AbortController();
  const abort = () => ac.abort();
  signal?.addEventListener('abort', abort);

  let painted = 0;
  let failed = 0;
  try {
    await runWithConcurrency(plan.tiles, MAX_CONCURRENT_TILES, async (tile) => {
      const outcome = await paintTile(
        {
          url: buildGetMapUrl(source, style, tile.bbox25833, tile.w, tile.h),
          dx: tile.dx,
          dy: tile.dy,
          dw: tile.w,
          dh: tile.h,
          ctx,
        },
        ac.signal,
      );
      if (outcome.kind === 'painted') painted++;
      else if (outcome.kind === 'failed') failed++;
    });
  } finally {
    signal?.removeEventListener('abort', abort);
  }

  // Throwing, not null: null means "no coverage" and is acted on below.
  if (signal?.aborted) throw new Error('extract cancelled');

  // `null` reaches the pin queue as `empty`, the one state whose card offers
  // no retry, so a network blip must not produce it.
  if (painted === 0 && failed > 0) {
    throw new Error(`every tile failed: ${source.label} / ${style}`);
  }
  if (painted === 0) return null;
  return {
    canvas,
    // What the stitch produced: planTiles scales down past its canvas cap.
    metresPerPx: (bbox25833[2] - bbox25833[0]) / plan.widthPx,
    widthPx: plan.widthPx,
    heightPx: plan.heightPx,
    bbox25833,
  };
}

// Abortable sleep, so the retry loop can bail on cancel.
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener('abort', onAbort);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort);
  });
}
