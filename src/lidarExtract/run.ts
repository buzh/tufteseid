// Stitches one (source × style) into a canvas at that source's native ground
// resolution — the national mosaic at 1 m/px, per-project layers at whatever
// their point density supports. Tiles that come back as blank PNGs (see
// BLANK_RESPONSE_THRESHOLD_BYTES) don't get painted; a canvas that ends with
// zero painted tiles is `null`, i.e. the rectangle is outside this source's
// coverage.
//
// There used to be a second, atom-driven entrance that ran every source ×
// style of a multi-source Hent at once and reported per-tile progress into
// `lidarExtractRunAtom` for the extract viewer to draw. The picker carousel
// (docs/lokalitet-view.md §4.3) fetches one card ahead of where you are
// standing instead, so the shared tile budget, the progress counters and the
// run atom all went with it — there is only ever one canvas in flight now.

import { LidarSource, nativeResolutionMetersPerPx } from './sources';
import {
  buildGetMapUrl,
  fetchAndPaint,
  planTiles,
  runWithConcurrency,
} from './stitch';

// Kept modest so a Hent doesn't drown the wmscache→Kartverket keepalive
// pool while regular map tiles are also flowing. Bumping this past ~4
// tends to trigger 502s from wmscache under real map-browsing load.
const MAX_CONCURRENT_TILES = 4;

// Transient 5xx from wmscache / Kartverket during bursts is common; a
// small retry with backoff turns the flakiness into eventual success.
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

// 'aborted' is not an outcome the caller records — the run it belonged to is
// gone, and counting it would finish a canvas nobody is watching.
type TileOutcomeKind = 'painted' | 'blank' | 'failed' | 'aborted';

// The retry loop. Reporting is deliberately not in here: the caller only
// cares how many tiles painted.
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
 * One source × one style, stitched. What "Hent grunnpakke", the pin queue and
 * every picker card run.
 *
 * `null` when nothing painted, i.e. the rectangle is outside this source's
 * coverage or every tile failed. There is no module-level abort controller:
 * cancellation is the caller's `signal`, so a background grab can never
 * cancel the extract somebody is watching.
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
    });
  } finally {
    signal?.removeEventListener('abort', abort);
  }

  if (painted === 0 || signal?.aborted) return null;
  return {
    canvas,
    // What the stitch actually produced: planTiles scales both axes down
    // together past its canvas cap, so on a large rectangle this is coarser
    // than the source's native resolution.
    metresPerPx: (bbox25833[2] - bbox25833[0]) / plan.widthPx,
    widthPx: plan.widthPx,
    heightPx: plan.heightPx,
    bbox25833,
  };
}

// Abortable sleep. Rejects immediately if the signal aborts; otherwise
// resolves after `ms`. Wrapped so the retry loop can bail on Cancel.
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
