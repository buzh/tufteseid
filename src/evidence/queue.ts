// Module-level: a render outlives the surface that started it, so closing a
// spot does not abandon pixels the reader decided to keep.
//
// One job at a time. Every producer is either a burst of tile requests against
// a shared public edge or an 800 ms horizon scan on the main thread, so two at
// once finish no sooner and invite shed responses.

import { attachEvidenceFile, type EvidenceRecord } from '../api/evidence';
import { requestSunLoop } from '../api/render';
import type { Bbox } from '../map/bbox';
import { withDeadline } from '../shared/utils/deadline';
import type { SunLoopLegend } from './legendContent';
import { renderEvidence } from './render';
import { specOf } from './spec';

/**
 * Where a row stands with the queue. Absent means "not the queue's business" —
 * either the pixels are there or nobody has asked. `failed` is a fault and
 * worth retrying; `empty` means the source has nothing over this rectangle and
 * retrying is pointless.
 */
export type RenderState = 'queued' | 'running' | 'empty' | 'failed';

const STATES: readonly RenderState[] = ['queued', 'running', 'empty', 'failed'];

// A sidecar render that never settled. Read as failed so a crashed worker
// offers a retry rather than an eternal hourglass.
const STALE_JOB_MS = 900000;

/**
 * The same four states, as the render sidecar left them in `meta.job` — for a
 * job this browser did not start, or was not open for. Absent once the file
 * lands: the sidecar writes the pixels and the meta in one request, and the
 * meta it writes has no marker.
 */
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
  /** The spot's footprint, EPSG:4326. */
  bbox4326: Bbox;
  /** The band the sidecar burns in. Only a `sunloop` reads it; null where the
   *  row's meta no longer describes a render. */
  legend: SunLoopLegend | null;
  /** The finished record, handed back to whoever is showing it. */
  onDone?: (rec: EvidenceRecord) => void;
};

// Ceilings on a stall, not budgets. The queue is serial, so a render that never
// settles parks every job behind it; expiry is treated as an ordinary `failed`,
// with a retry. The upload gets the same, which is 50 MB — the field's cap — at
// about 1.5 Mbit/s up.
const RENDER_DEADLINE_MS = 300000;
const UPLOAD_DEADLINE_MS = 300000;
// The sidecar answers as soon as it has claimed the row; the render itself is
// not on this clock.
const HANDOVER_DEADLINE_MS = 30000;

const queue: RenderJob[] = [];
const states = new Map<string, RenderState>();
const listeners = new Set<() => void>();
let draining = false;

// Copied on publish rather than handed out live: `useSyncExternalStore` decides
// whether to re-render by identity, and a Map mutated in place never changes.
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

/** Every row the queue has an opinion about, keyed by evidence id. */
export const renderStates = (): ReadonlyMap<string, RenderState> => snapshot;

// PocketBase's ClientResponseError logs only "400: Failed to update record.";
// the field that actually failed is in `response.data`.
const failureDetail = (e: unknown): string => {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  return data && typeof data === 'object' ? JSON.stringify(data) : '';
};

const runJob = async (job: RenderJob): Promise<EvidenceRecord | null> => {
  const spec = specOf(job.rec);
  // A row whose meta no longer parses: `failed` would offer a retry against
  // nothing.
  if (!spec) {
    states.set(job.rec.id, 'empty');
    return null;
  }

  // Handed to the sidecar, which renders it and PATCHes the file on itself. The
  // row is then realtime's to report on, and this queue drops it — a loop that
  // takes minutes must not park every other job behind it, and it outlives the
  // tab either way.
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

  const produced = await withDeadline(
    RENDER_DEADLINE_MS,
    `${spec.kind} render`,
    (signal) => renderEvidence(spec, job.bbox4326, signal),
  );
  if (!produced) {
    states.set(job.rec.id, 'empty');
    return null;
  }

  // No signal: a multipart PATCH already on the wire cannot be taken back, so
  // the deadline only guarantees rejection — the queue moves on while the
  // browser finishes or drops the transfer in its own time.
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

const drain = async () => {
  if (draining) return;
  draining = true;
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
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
    }
  } finally {
    draining = false;
  }
};

/**
 * Idempotent while a job is in flight — the guard is on the live state rather
 * than on having been asked, so a `failed` or `empty` row can still be retried.
 */
export const enqueueRender = (job: RenderJob): void => {
  const state = states.get(job.rec.id);
  if (state === 'queued' || state === 'running') return;
  states.set(job.rec.id, 'queued');
  queue.push(job);
  publish();
  void drain();
};
