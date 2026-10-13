import { atom, getDefaultStore } from 'jotai';
import { ORIGIN_IDS, ORIGINS, type OriginId } from './origins';

const FAIL_THRESHOLD = 3;
const FAIL_WINDOW_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;
const PROBE_BACKOFF_MS = [20_000, 40_000, 80_000, 120_000];
const HEALTHY_RESET_MS = 60_000;

export type OriginStatus = {
  down: boolean;
  nextProbeAt: number | null;
  probing: boolean;
};

const initialStatus = (): OriginStatus => ({
  down: false,
  nextProbeAt: null,
  probing: false,
});

const fromEntries = <T>(make: () => T): Record<OriginId, T> =>
  Object.fromEntries(ORIGIN_IDS.map((id) => [id, make()])) as Record<
    OriginId,
    T
  >;

export const upstreamHealthAtom = atom<Record<OriginId, OriginStatus>>(
  fromEntries(initialStatus),
);

type Live = OriginStatus & {
  failures: number;
  lastFailureAt: number;
  attempts: number;
  okSince: number;
  timer: number | null;
};

const live: Record<OriginId, Live> = fromEntries(() => ({
  ...initialStatus(),
  failures: 0,
  lastFailureAt: 0,
  attempts: 0,
  okSince: Date.now(),
  timer: null,
}));

const publish = () => {
  const store = getDefaultStore();
  const prev = store.get(upstreamHealthAtom);
  const changed = ORIGIN_IDS.some(
    (id) =>
      prev[id].down !== live[id].down ||
      prev[id].nextProbeAt !== live[id].nextProbeAt ||
      prev[id].probing !== live[id].probing,
  );
  if (!changed) return;
  store.set(
    upstreamHealthAtom,
    Object.fromEntries(
      ORIGIN_IDS.map((id) => [
        id,
        {
          down: live[id].down,
          nextProbeAt: live[id].nextProbeAt,
          probing: live[id].probing,
        },
      ]),
    ) as Record<OriginId, OriginStatus>,
  );
};

type RecoverListener = (id: OriginId) => void;
const recoverListeners = new Set<RecoverListener>();

export const onOriginRecovered = (fn: RecoverListener): void => {
  recoverListeners.add(fn);
};

export const mayRequest = (id: OriginId): boolean => !live[id].down;

export class UpstreamDownError extends Error {
  readonly origin: OriginId;
  constructor(what: string, origin: OriginId) {
    super(`${what} not attempted: ${origin} is not answering`);
    this.name = 'UpstreamDownError';
    this.origin = origin;
  }
}

export const isUpstreamDown = (err: unknown): err is UpstreamDownError =>
  err instanceof UpstreamDownError;

const clearTimer = (l: Live) => {
  if (l.timer != null) window.clearTimeout(l.timer);
  l.timer = null;
};

const armProbe = (id: OriginId) => {
  const l = live[id];
  clearTimer(l);
  const delay =
    PROBE_BACKOFF_MS[Math.min(l.attempts, PROBE_BACKOFF_MS.length - 1)]!;
  l.nextProbeAt = Date.now() + delay;
  l.timer = window.setTimeout(() => {
    void probe(id);
  }, delay);
  publish();
};

const trip = (id: OriginId) => {
  const l = live[id];
  if (l.down) return;
  if (Date.now() - l.okSince >= HEALTHY_RESET_MS) {
    l.attempts = 0;
  } else {
    l.attempts += 1;
  }
  l.down = true;
  console.warn(
    '[upstream] %s stopped answering after %d failures — holding off',
    id,
    l.failures,
  );
  armProbe(id);
};

const recover = (id: OriginId) => {
  const l = live[id];
  clearTimer(l);
  l.failures = 0;
  l.nextProbeAt = null;
  l.probing = false;
  l.okSince = Date.now();
  if (l.down) {
    l.down = false;
    console.info('[upstream] %s is answering again', id);
    for (const fn of recoverListeners) fn(id);
  }
  publish();
};

export const reportFailure = (id: OriginId) => {
  const l = live[id];
  const now = Date.now();
  l.failures = now - l.lastFailureAt > FAIL_WINDOW_MS ? 1 : l.failures + 1;
  l.lastFailureAt = now;
  if (l.failures >= FAIL_THRESHOLD) trip(id);
};

export const reportSuccess = (id: OriginId) => {
  const l = live[id];
  if (l.down) {
    recover(id);
    return;
  }
  if (l.failures === 0) return;
  l.failures -= 1;
  if (l.failures === 0) l.okSince = Date.now();
};

export const reportStatus = (id: OriginId, status: number) => {
  if (status >= 500) reportFailure(id);
  else reportSuccess(id);
};

const probeUrl = (id: OriginId): string => {
  const url = ORIGINS[id].probeUrl;
  return url.startsWith('/') ? `${url}&_probe=${Date.now()}` : url;
};

const probe = async (id: OriginId) => {
  const l = live[id];
  l.probing = true;
  l.nextProbeAt = null;
  publish();
  try {
    const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
    const res = await fetch(probeUrl(id), { signal, cache: 'no-store' });
    await res.arrayBuffer();
    l.probing = false;
    if (res.status < 500) {
      recover(id);
      return;
    }
  } catch {
    l.probing = false;
  }
  l.attempts += 1;
  armProbe(id);
};

export const probeNow = (id: OriginId) => {
  const l = live[id];
  if (!l.down || l.probing) return;
  clearTimer(l);
  void probe(id);
};
