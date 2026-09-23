// One circuit breaker per origin. A request the breaker refused is never
// retried, so the way back up is `refresh()` from `onOriginRecovered`.

import { atom, getDefaultStore } from 'jotai';
import { ORIGIN_IDS, ORIGINS, type OriginId } from './origins';

/** Failures net of successes that trip the breaker. */
const FAIL_THRESHOLD = 3;
/** How long a failure counts for. */
const FAIL_WINDOW_MS = 60_000;
/** Well under the proxy's own 30 s read timeout. */
const PROBE_TIMEOUT_MS = 8_000;
/** Gap before each probe, indexed by `attempts`. */
const PROBE_BACKOFF_MS = [20_000, 40_000, 80_000, 120_000];
/** How long an origin must stay up before the backoff forgets the outage. */
const HEALTHY_RESET_MS = 60_000;

export type OriginStatus = {
  down: boolean;
  /** Epoch ms of the next automatic probe; null unless down. */
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
  /**
   * Failures net of successes, over a run of trouble no two failures of which
   * are more than FAIL_WINDOW_MS apart.
   */
  failures: number;
  lastFailureAt: number;
  /** Outages and failed probes since the origin was last durably healthy. */
  attempts: number;
  /** When the origin last became healthy. */
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

// Tile loads report one by one, so publish only on a change: a `store.set` per
// tile would re-render every subscriber a dozen times a pan.
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

// OpenLayers caches a tile's ERROR state and never re-requests, so whoever can
// redraw registers here.
type RecoverListener = (id: OriginId) => void;
const recoverListeners = new Set<RecoverListener>();

export const onOriginRecovered = (fn: RecoverListener): void => {
  recoverListeners.add(fn);
};

export const mayRequest = (id: OriginId): boolean => !live[id].down;

/** Thrown in place of a request that was never made. */
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
    // Quiet since the last trouble: a new outage, at the shortest wait.
    l.attempts = 0;
  } else {
    // The same episode flapping; charge it a step of backoff.
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

/**
 * Timeouts, decode failures and the WMS rate-limit exception (HTTP 200 with a
 * ServiceException body, see `wmsTileGrid.ts`) all count the same.
 */
export const reportFailure = (id: OriginId) => {
  const l = live[id];
  const now = Date.now();
  l.failures = now - l.lastFailureAt > FAIL_WINDOW_MS ? 1 : l.failures + 1;
  l.lastFailureAt = now;
  if (l.failures >= FAIL_THRESHOLD) trip(id);
};

/**
 * Pays the failure counter down by one rather than zeroing it: wmscache serves
 * cached tiles straight through an upstream 504, so hits and failures
 * interleave and a zeroing rule would never trip.
 */
export const reportSuccess = (id: OriginId) => {
  const l = live[id];
  // Only the probe reaches this while down; nothing else is let through.
  if (l.down) {
    recover(id);
    return;
  }
  if (l.failures === 0) return;
  l.failures -= 1;
  if (l.failures === 0) l.okSince = Date.now();
};

/**
 * 5xx is the service breaking; anything else is the service working and
 * disagreeing. Fails open, so a probe URL that goes stale and starts returning
 * 400 reads as up rather than wedging the origin shut.
 */
export const reportStatus = (id: OriginId, status: number) => {
  if (status >= 500) reportFailure(id);
  else reportSuccess(id);
};

/**
 * A relative URL is answered by wmscache, which serves stale on 503/504, so a
 * probe matching a stored entry would never see the outage — hence the cache
 * buster. An absolute one goes to a CDN, where `no-store` is enough.
 */
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
    // Not `fetchWithin`: that module imports this one.
    const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
    const res = await fetch(probeUrl(id), { signal, cache: 'no-store' });
    // Drained under the same signal: `fetch` resolves on the headers, and an
    // origin that sends them and then stops is the failure mode here.
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

/** Skips the backoff, once. */
export const probeNow = (id: OriginId) => {
  const l = live[id];
  if (!l.down || l.probing) return;
  clearTimer(l);
  void probe(id);
};
