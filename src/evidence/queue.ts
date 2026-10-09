// A render outlives the surface that started it, so closing a spot does not
// abandon pixels the reader chose to keep. One row renders at a time: every
// producer is a burst against a shared public edge or an 800 ms main-thread
// scan, so parallelism gains nothing and invites shed responses. Previews are
// the one exception (PREVIEW_LANES).

import { attachEvidenceFile, type EvidenceRecord } from '../api/evidence';
import { requestRvtBlend, requestSunLoop } from '../api/render';
import type { Bbox } from '../map/bbox';
import { withDeadline } from '../shared/utils/deadline';
import type { SunLoopLegend } from './legendContent';
import { renderEvidence, type BrowserSpec, type Produced } from './render';
import { specOf } from './spec';

// Absent means "not the queue's business": the pixels are there or nobody asked.
// `failed` is a fault; `empty` says the source had nothing over this rectangle.
export type RenderState = 'queued' | 'running' | 'empty' | 'failed';

const STATES: readonly RenderState[] = ['queued', 'running', 'empty', 'failed'];

/** Neither settled state (`failed`, `empty`) is terminal. */
export const mayRetry = (state: RenderState | undefined): boolean =>
  state === 'failed' || state === 'empty';

// The sidecar beats `job.at` every minute while a job is queued or running
// (`BEAT_S` in `rendersvc/server.py`); five beats' silence is a dead worker,
// not a slow one. A job can legitimately hold for ~an hour (fetch retries, three
// encode attempts).
const STALE_JOB_MS = 300000;

// Absent once the file lands: the sidecar writes pixels and meta in one request
// and the meta it writes has no marker. Only sidecar-rendered kinds carry one.
export const jobState = (rec: EvidenceRecord): RenderState | undefined => {
  const job = rec.meta?.job;
  if (!job || typeof job !== 'object') return undefined;
  const { state, at } = job as { state?: unknown; at?: unknown };
  if (!STATES.includes(state as RenderState)) return undefined;
  if (state === 'empty' || state === 'failed') return state;
  const since = typeof at === 'string' ? Date.parse(at) : NaN;
  return Number.isFinite(since) && Date.now() - since > STALE_JOB_MS
    ? 'failed'
    : (state as RenderState);
};

type RenderJob = {
  rec: EvidenceRecord;
  /** EPSG:4326. */
  bbox4326: Bbox;
  /** The band the sidecar burns in; only a `sunloop` carries one, else null. */
  legend: SunLoopLegend | null;
  onDone?: (rec: EvidenceRecord) => void;
};

// Ceilings on a stall, not budgets: a never-settling render parks the jobs
// behind it, so expiry is an ordinary `failed` with a retry. 50 MB (the field's
// cap) at ~1.5 Mbit/s up.
const RENDER_DEADLINE_MS = 300000;
const UPLOAD_DEADLINE_MS = 300000;
// The sidecar answers once it has claimed the row; the render is not on this clock.
const HANDOVER_DEADLINE_MS = 30000;

// Also how far ahead of the proposal a picker looks: raising one without the
// other buys nothing, since a run wants a render going in every lane it may use.
export const PREVIEW_LANES = 2;

// Thunks, not jobs: a preview has no row to keep a state for, and settles itself
// so the pump never sees a throw. `solo` is a row's render, which runs alone.
type Task = { run: () => Promise<void>; solo: boolean };

const queue: Task[] = [];
const states = new Map<string, RenderState>();
const listeners = new Set<() => void>();
let busy = 0;
let soloBusy = false;

// Copied on publish: `useSyncExternalStore` compares by identity, and a Map
// mutated in place never changes.
let snapshot: ReadonlyMap<string, RenderState> = new Map();

const publish = () => {
  snapshot = new Map(states);
  for (const fn of listeners) fn();
};

export const subscribeRenderQueue = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const renderStates = (): ReadonlyMap<string, RenderState> => snapshot;

// PocketBase's ClientResponseError logs only "400: Failed to update record.";
// the field that actually failed is in `response.data`.
const failureDetail = (e: unknown): string => {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  return data && typeof data === 'object' ? JSON.stringify(data) : '';
};

const runJob = async (job: RenderJob): Promise<EvidenceRecord | null> => {
  const spec = specOf(job.rec);
  // Meta no longer parses; `failed` would offer a retry against nothing.
  if (!spec) {
    states.set(job.rec.id, 'empty');
    return null;
  }

  // Handed to the sidecar, which PATCHes the file on itself; the row is then
  // realtime's to report on and this queue drops it, so a minutes-long render
  // parks nothing behind it.
  if (spec.kind === 'sunloop') {
    if (!job.legend) {
      states.set(job.rec.id, 'empty');
      return null;
    }
    const legend = job.legend;
    await withDeadline(HANDOVER_DEADLINE_MS, 'sun loop handover', () =>
      requestSunLoop(job.rec.id, legend),
    );
    states.delete(job.rec.id);
    return null;
  }

  if (spec.kind === 'rvt') {
    await withDeadline(HANDOVER_DEADLINE_MS, 'rvt handover', () =>
      requestRvtBlend(job.rec.id),
    );
    states.delete(job.rec.id);
    return null;
  }

  const produced = await withDeadline(
    RENDER_DEADLINE_MS,
    `${spec.kind} render`,
    (signal) => renderEvidence(spec, job.bbox4326, signal),
  );
  if (!produced) {
    states.set(job.rec.id, 'empty');
    return null;
  }

  // No signal: a multipart PATCH on the wire cannot be taken back, so the
  // deadline only rejects — the browser finishes or drops it in its own time.
  const done = await withDeadline(UPLOAD_DEADLINE_MS, 'evidence upload', () =>
    attachEvidenceFile(job.rec.id, produced.blob, produced.filename, {
      ...(job.rec.meta ?? {}),
      ...produced.meta,
      renderedAt: new Date().toISOString(),
    }),
  );
  states.delete(job.rec.id);
  job.onDone?.(done);
  return done;
};

// Strictly in order, so a `solo` at the head holds previews behind it: a row the
// reader asked for is never starved by a run that keeps proposing.
const pump = () => {
  while (queue.length > 0 && !soloBusy) {
    const next = queue[0];
    if (next.solo ? busy > 0 : busy >= PREVIEW_LANES) return;
    queue.shift();
    busy += 1;
    if (next.solo) soloBusy = true;
    void next.run().finally(() => {
      busy -= 1;
      if (next.solo) soloBusy = false;
      pump();
    });
  }
};

// Idempotent while in flight: the guard is on live state, not on having been
// asked, so a `failed` or `empty` row can still be retried.
export const enqueueRender = (job: RenderJob): void => {
  const state = states.get(job.rec.id);
  if (state === 'queued' || state === 'running') return;
  states.set(job.rec.id, 'queued');
  queue.push({
    solo: true,
    run: async () => {
      states.set(job.rec.id, 'running');
      publish();
      try {
        await runJob(job);
      } catch (e) {
        console.warn(
          '[evidence] render failed',
          job.rec.id,
          failureDetail(e),
          e,
        );
        states.set(job.rec.id, 'failed');
      }
      publish();
    },
  });
  publish();
  pump();
};

// Pixels with no row behind them, shown before the reader decides to keep them.
// `signal` gates the queue position, not the render: a burst on the wire ends on
// its own deadline and only its result is dropped. Rejects with the signal's
// reason for a preview no longer wanted.
export const enqueuePreview = (
  spec: BrowserSpec,
  bbox4326: Bbox,
  signal: AbortSignal,
): Promise<Produced | null> =>
  new Promise((resolve, reject) => {
    queue.push({
      solo: false,
      run: async () => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        await withDeadline(
          RENDER_DEADLINE_MS,
          `${spec.kind} preview`,
          (inner) => renderEvidence(spec, bbox4326, inner),
        ).then(resolve, reject);
      },
    });
    pump();
  });
