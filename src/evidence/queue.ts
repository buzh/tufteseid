// The render queue: a kept row is parameters, and this is what turns it into
// the image and PATCHes it onto the record afterwards.
//
// Module-level and React-free so it outlives the surface that started it —
// closing a spot must not abandon pixels the reader decided to keep — and each
// render is one atomic update. React reads it through `useRenderQueue`.
//
// One job at a time: every producer is a burst of tile requests against a
// shared public edge, or an 800 ms horizon scan on the main thread. Two at once
// finish no sooner and invite shed responses.

import {
  attachEvidenceFile,
  type EvidenceRecord,
} from '../api/evidence';
import type { Bbox } from '../map/bbox';
import { withDeadline } from '../shared/utils/deadline';
import { renderEvidence } from './render';
import { specOf } from './spec';

/**
 * Where a row stands with the queue. Absent means "not the queue's business" —
 * either the pixels are there or nobody has asked. `failed` is a fault and
 * worth retrying; `empty` means the source has nothing over this rectangle and
 * retrying is pointless.
 */
export type RenderState = 'queued' | 'running' | 'empty' | 'failed';

export type RenderJob = {
  rec: EvidenceRecord;
  /** The spot's footprint, EPSG:4326. */
  bbox4326: Bbox;
  /** The finished record, handed back to whoever is showing it. */
  onDone?: (rec: EvidenceRecord) => void;
};

// Ceilings on a stall, not budgets. The queue is serial, so a render that never
// settles parks every job behind it; expiry is treated as an ordinary `failed`,
// with a retry. The upload gets the same, which is 50 MB — the field's cap — at
// about 1.5 Mbit/s up.
const RENDER_DEADLINE_MS = 300000;
const UPLOAD_DEADLINE_MS = 300000;

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

/** One job, start to finish. Resolves to the finished record, or null. */
const runJob = async (job: RenderJob): Promise<EvidenceRecord | null> => {
  const spec = specOf(job.rec);
  // A row whose meta no longer parses: `failed` would offer a retry against
  // nothing.
  if (!spec) {
    states.set(job.rec.id, 'empty');
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
 * Ask for a row's pixels. Returns at once; the work happens behind. Idempotent
 * while a job is in flight — the guard is on the live state rather than on
 * having been asked, so a `failed` or `empty` row can still be retried.
 */
export const enqueueRender = (job: RenderJob): void => {
  const state = states.get(job.rec.id);
  if (state === 'queued' || state === 'running') return;
  states.set(job.rec.id, 'queued');
  queue.push(job);
  publish();
  void drain();
};
