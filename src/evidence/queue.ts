import { attachEvidenceFile, type EvidenceRecord } from '../api/evidence';
import { RenderRefused, requestRvtBlend, requestSunLoop } from '../api/render';
import type { Bbox } from '../map/bbox';
import { withDeadline } from '../shared/utils/deadline';
import type { SunLoopLegend } from './legendContent';
import { renderEvidence, type BrowserSpec, type Produced } from './render';
import { specOf } from './spec';

export type RenderState = 'queued' | 'running' | 'empty' | 'failed';

const STATES: readonly RenderState[] = ['queued', 'running', 'empty', 'failed'];

export const mayRetry = (state: RenderState | undefined): boolean =>
  state === 'failed' || state === 'empty';

const STALE_JOB_MS = 300000;

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
  bbox4326: Bbox;
  legend: SunLoopLegend | null;
  onDone?: (rec: EvidenceRecord) => void;
  onRefused?: () => void;
};

const RENDER_DEADLINE_MS = 300000;
const UPLOAD_DEADLINE_MS = 300000;
const HANDOVER_DEADLINE_MS = 30000;

export const PREVIEW_LANES = 2;

type Task = { run: () => Promise<void>; solo: boolean };

const queue: Task[] = [];
const states = new Map<string, RenderState>();
const listeners = new Set<() => void>();
let busy = 0;
let soloBusy = false;

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

const failureDetail = (e: unknown): string => {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  return data && typeof data === 'object' ? JSON.stringify(data) : '';
};

const runJob = async (job: RenderJob): Promise<EvidenceRecord | null> => {
  const spec = specOf(job.rec);
  if (!spec) {
    states.set(job.rec.id, 'empty');
    return null;
  }

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
        if (e instanceof RenderRefused) job.onRefused?.();
      }
      publish();
    },
  });
  publish();
  pump();
};

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
