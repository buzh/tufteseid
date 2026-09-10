// Orchestrates a single extraction run. Each (source × style) gets its
// own canvas rendered at that source's native ground resolution — the
// national mosaic at 1 m/px, per-project layers at whatever their point
// density supports. Tiles that come back as blank PNGs (see
// BLANK_RESPONSE_THRESHOLD_BYTES) don't get painted; a canvas that ends
// with zero painted tiles is reported as noCoverage so the panel can
// hide its empty preview.

import { getDefaultStore } from 'jotai';
import {
  LidarCanvas,
  LidarExtractRun,
  lidarExtractRunAtom,
} from './atoms';
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

export type StylesBySource = Record<string, string[]>;

let currentAbort: AbortController | null = null;

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

// The retry loop both entrances share. Progress reporting is deliberately not
// in here: the interactive run pushes per-tile counters into an atom, the
// headless one only cares how many tiles painted.
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
 * One source × one style, stitched, with no atom in sight — what "Hent
 * grunnpakke" runs.
 *
 * Separate from `startExtraction` rather than a special case of it: that one
 * exists to *report*, spending a shared tile budget across every canvas of a
 * multi-source run and pushing per-tile counters into `lidarExtractRunAtom`
 * as they land. This one has a single canvas and one thing to say about it at
 * the end. It also does not touch `currentAbort`, so a background grab can
 * never cancel the extract the user is watching.
 *
 * `null` when nothing painted, i.e. the rectangle is outside this source's
 * coverage or every tile failed — the same meaning `noCoverage` has in the
 * interactive run.
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

export function startExtraction(
  bbox25833: [number, number, number, number],
  sources: LidarSource[],
  stylesBySource: StylesBySource,
): LidarExtractRun {
  currentAbort?.abort();
  const abort = new AbortController();
  currentAbort = abort;

  const store = getDefaultStore();
  const runId = Date.now();

  const canvases: LidarCanvas[] = [];
  const workItems: Array<TileJob & { canvasId: string }> = [];

  for (const source of sources) {
    const styles = stylesBySource[source.key] ?? [];
    const metresPerPx = nativeResolutionMetersPerPx(source);
    for (const style of styles) {
      const plan = planTiles(bbox25833, metresPerPx);
      const canvas = document.createElement('canvas');
      canvas.width = plan.widthPx;
      canvas.height = plan.heightPx;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      const canvasId = `${source.key}::${style}`;
      canvases.push({
        id: canvasId,
        sourceKey: source.key,
        sourceLabel: source.label,
        style,
        metresPerPx,
        widthPx: plan.widthPx,
        heightPx: plan.heightPx,
        canvas,
        tilesTotal: plan.tiles.length,
        tilesDone: 0,
        tilesBlank: 0,
        tilesFailed: 0,
        status: plan.tiles.length === 0 ? 'done' : 'pending',
      });

      for (const tile of plan.tiles) {
        workItems.push({
          canvasId,
          url: buildGetMapUrl(source, style, tile.bbox25833, tile.w, tile.h),
          dx: tile.dx,
          dy: tile.dy,
          dw: tile.w,
          dh: tile.h,
          ctx,
        });
      }
    }
  }

  const run: LidarExtractRun = {
    runId,
    bbox25833,
    canvases,
    startedAt: Date.now(),
  };
  store.set(lidarExtractRunAtom, run);

  void runWithConcurrency(workItems, MAX_CONCURRENT_TILES, async (item) => {
    if (abort.signal.aborted) return;
    markStatus(runId, item.canvasId, 'fetching');
    const outcome = await paintTile(item, abort.signal);
    if (outcome.kind === 'aborted') return;
    recordTileDone(runId, item.canvasId, {
      blank: outcome.kind === 'blank',
      failed: outcome.kind === 'failed',
      errorMessage: outcome.errorMessage,
    });
  });

  return run;
}

export function cancelExtraction(): void {
  currentAbort?.abort();
  currentAbort = null;
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

function updateRun(
  runId: number,
  updater: (run: LidarExtractRun) => LidarExtractRun,
) {
  const store = getDefaultStore();
  const current = store.get(lidarExtractRunAtom);
  if (!current || current.runId !== runId) return;
  store.set(lidarExtractRunAtom, updater(current));
}

function markStatus(
  runId: number,
  canvasId: string,
  status: LidarCanvas['status'],
) {
  updateRun(runId, (run) => ({
    ...run,
    canvases: run.canvases.map((c) =>
      c.id === canvasId && c.status === 'pending' ? { ...c, status } : c,
    ),
  }));
}

type TileOutcome = {
  blank: boolean;
  failed: boolean;
  errorMessage?: string;
};

function recordTileDone(
  runId: number,
  canvasId: string,
  outcome: TileOutcome,
) {
  updateRun(runId, (run) => ({
    ...run,
    canvases: run.canvases.map((c) => {
      if (c.id !== canvasId) return c;
      const tilesDone = c.tilesDone + 1;
      const tilesBlank = c.tilesBlank + (outcome.blank ? 1 : 0);
      const tilesFailed = c.tilesFailed + (outcome.failed ? 1 : 0);
      const finished = tilesDone >= c.tilesTotal;
      let status: LidarCanvas['status'] = c.status;
      let error = c.error;
      if (finished) {
        const painted = tilesDone - tilesBlank - tilesFailed;
        if (tilesFailed === c.tilesTotal) {
          status = 'error';
          error = outcome.errorMessage ?? c.error ?? 'Alle fliser feilet';
        } else if (painted === 0) {
          status = 'noCoverage';
        } else {
          status = 'done';
        }
      }
      return { ...c, tilesDone, tilesBlank, tilesFailed, status, error };
    }),
  }));
}
