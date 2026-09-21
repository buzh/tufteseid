// One circuit breaker per origin: stop asking a service that is not answering,
// and say so.
//
// The case for it is what an outage costs without it. On 2026-09-21 every
// Kartverket height endpoint answered HTTP 504 after a flat 30 seconds — the
// `proxy_read_timeout` in `nginx/wms-proxy-common.conf`, which deliberately
// does not retry on timeout because a slow render is usually a render. A
// screenful is a dozen tiles; each pan queued a dozen more; the footprint WFS
// fired up to sixty lookups per viewport, three tries each. All of it went to a
// backend that had nothing to give, and the reader was told none of it — the
// map simply stayed empty.
//
// So: count failures net of successes, and three ahead, stop issuing requests
// to that origin at all. Recovery is not guessed at but measured, by one tiny
// probe on a growing backoff (`origins.ts`). Nothing here retries a tile;
// OpenLayers marks a refused tile ERROR and never asks again, so the way back
// is `refresh()` on the sources once the probe says the service is real again.

import { atom, getDefaultStore } from 'jotai';
import { ORIGIN_IDS, ORIGINS, type OriginId } from './origins';

/** Failures net of successes that trip the breaker. */
const FAIL_THRESHOLD = 3;
/**
 * How long a failure counts for. Without it a service that drops one tile a
 * week would eventually trip on the third one, years apart.
 */
const FAIL_WINDOW_MS = 60_000;
/**
 * The probe's own budget. Well under the proxy's 30 s so a dead origin is
 * known to be dead quickly, and far over the 190 ms a healthy one takes.
 */
const PROBE_TIMEOUT_MS = 8_000;
/** Gap before each probe, by how long this has been going on. */
const PROBE_BACKOFF_MS = [20_000, 40_000, 80_000, 120_000];
/**
 * How long an origin has to stay up before the backoff forgets the outage.
 *
 * This is what damps a flapping service. A probe can succeed — it is one
 * request, and one request can land on the one healthy backend behind a
 * balancer — while the screenful behind it still fails. Resetting the backoff
 * on that would re-probe every 20 s forever, and re-refresh a screenful of
 * tiles each time. Resetting it on a minute of quiet does not.
 */
const HEALTHY_RESET_MS = 60_000;

/** What a surface needs to know. Published only when one of them changes. */
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
  /**
   * Outages and failed probes since the origin was last durably healthy.
   * Indexes PROBE_BACKOFF_MS.
   */
  attempts: number;
  /** When the origin last became healthy, for the HEALTHY_RESET_MS rule. */
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

// Tile loads report one by one, so the common path is a success on an origin
// that was already healthy: nothing to publish, and a `store.set` per tile
// would re-render the ribbon a dozen times a pan.
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

// Refusing a tile is not enough to get it back: OpenLayers caches the ERROR
// state and never re-requests. Whoever can redraw registers here, and
// `tileGuard.ts` is the one that does.
type RecoverListener = (id: OriginId) => void;
const recoverListeners = new Set<RecoverListener>();

export const onOriginRecovered = (fn: RecoverListener): void => {
  recoverListeners.add(fn);
};

/**
 * Whether a request to this origin should be issued at all. The one question
 * every caller asks; everything else in here exists to answer it.
 */
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

// `attempts` is how many waits this episode has already served, so it indexes
// the table directly: a fresh outage is at 0 and waits the first 20 s.
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
    // A minute of quiet since the last trouble: a new outage, starting over at
    // the shortest wait.
    l.attempts = 0;
  } else {
    // Tripped again almost immediately after a probe said it was up, which is
    // the same episode flapping rather than a new one. Charge it a step, or
    // the pair will sit at twenty seconds apart for as long as it lasts —
    // re-refreshing a screenful of tiles each time round.
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
 * A request to this origin did not produce a picture. Does not distinguish a
 * gateway timeout from a decode failure — from a tile there is nothing to
 * distinguish them with, and both mean the same thing to the reader. That the
 * rate-limit exception (HTTP 200, a 238-byte ServiceException, see
 * `wmsTileGrid.ts`) lands here too is deliberate: backing off is the right
 * answer to being over budget as well.
 */
export const reportFailure = (id: OriginId) => {
  const l = live[id];
  const now = Date.now();
  l.failures = now - l.lastFailureAt > FAIL_WINDOW_MS ? 1 : l.failures + 1;
  l.lastFailureAt = now;
  if (l.failures >= FAIL_THRESHOLD) trip(id);
};

/**
 * A request to this origin produced something.
 *
 * It pays the counter down by one rather than zeroing it, and that is the
 * difference between a breaker that trips in this outage and one that does
 * not. wmscache serves cached tiles straight through an upstream 504
 * (`proxy_cache_use_stale`), so a pan across half-visited ground interleaves
 * hits and failures; on a zeroing rule one lucky hit per screenful holds the
 * counter under the threshold forever, and eleven twelfths of the map stays
 * blank with nothing said about it. Netting instead, the breaker trips when
 * failures outnumber successes, which is exactly when it should.
 */
export const reportSuccess = (id: OriginId) => {
  const l = live[id];
  // Only the probe can reach this while down — nothing else is let through.
  if (l.down) {
    recover(id);
    return;
  }
  if (l.failures === 0) return;
  l.failures -= 1;
  if (l.failures === 0) l.okSince = Date.now();
};

/**
 * Classify an answer we have a status line for.
 *
 * 5xx is the service breaking; anything else is the service working and
 * possibly disagreeing with us. That split makes the whole mechanism fail
 * open: a probe URL that goes stale and starts returning 400 reads as *up*,
 * which costs nothing, where the other reading would wedge the origin shut
 * with no way back.
 */
export const reportStatus = (id: OriginId, status: number) => {
  if (status >= 500) reportFailure(id);
  else reportSuccess(id);
};

/**
 * A relative URL is one wmscache answers, and wmscache holds a 180-day LRU
 * with `proxy_cache_use_stale … http_503 http_504` on it — so a probe that
 * matched a stored entry would be answered by our own disk while the service
 * behind it was dead, and the breaker would never trip. The WMS probes are
 * under the 300-byte floor that keeps them out of the cache in the first place
 * (`origins.ts`), but that is a property of the answer, not of the question;
 * the one that costs nothing to guarantee is guaranteed here.
 *
 * No buster on the absolute one: that goes straight to Kartverket's CDN, where
 * a unique key is a miss at their origin every twenty seconds and `no-store`
 * on the request is the honest way to get past our own browser cache.
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
    // `AbortSignal.timeout` rather than `withDeadline` from
    // `shared/utils/deadline`: that module calls into this one, and a cycle
    // between them would buy nothing here — `fetch` honours a signal, which is
    // the only case `withDeadline` exists to cover.
    //
    // `no-store` is the browser half of what `probeUrl` does for the proxy
    // half; it is what the WMTS probe relies on, cache.kartverket.no being the
    // one upstream that sends a max-age worth obeying.
    const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
    const res = await fetch(probeUrl(id), { signal, cache: 'no-store' });
    // Drained under the same signal: `fetch` resolves on the headers, and an
    // origin that sends them and then stops is exactly the failure mode here.
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

/** The reader asking rather than waiting. Skips the backoff, once. */
export const probeNow = (id: OriginId) => {
  const l = live[id];
  if (!l.down || l.probing) return;
  clearTimer(l);
  void probe(id);
};
