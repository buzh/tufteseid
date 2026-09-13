/*
 * Deadlines, for work that can stall instead of failing.
 *
 * `fetch` has no time limit of its own: a connection that is accepted and then
 * goes quiet leaves its promise pending for as long as the tab lives. None of
 * the tile paths notice, because every retry loop in them is driven by
 * rejections and a socket that never answers never produces one. The pin queue
 * runs one job at a time, so a single stalled tile does not cost one image —
 * it stops the queue, and every card behind it spins until the page is
 * reloaded. That is the failure this module exists to make impossible, and it
 * is the one shape of breakage the user cannot tell from "still working".
 *
 * Two levels, because neither subsumes the other:
 *
 * - `fetchWithin` bounds one request, which turns a stalled socket back into
 *   the ordinary transient error the retry loops already handle. That is the
 *   one that keeps a hiccup from costing a whole render.
 * - `withDeadline` bounds a whole piece of work regardless of what it is made
 *   of, so a producer that finds some other way to wait — thirty tiles each
 *   retrying just inside their own limit, a decode that never settles — still
 *   ends. That is the one that keeps a promise a caller is waiting on.
 */

/**
 * Thrown when `withDeadline` gives up, and passed as the abort reason, so what
 * surfaces in a console says which budget was blown rather than the DOM's
 * "signal is aborted without reason".
 */
export class DeadlineError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} exceeded its ${Math.round(ms / 1000)} s deadline`);
    this.name = 'DeadlineError';
  }
}

/**
 * Run something with a time limit, and tell it when the limit is up.
 *
 * The signal is the courtesy: a producer that threads it into its requests
 * stops making new ones, and stops paying for the ones in flight. The
 * rejection is the guarantee — this settles on time whether or not anything
 * downstream honours the signal, which is the property the caller actually
 * needs, since "the work is wedged" and "the work ignores signals" look the
 * same from out here.
 */
export const withDeadline = async <T>(
  ms: number,
  label: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const ac = new AbortController();
  let expire!: (e: unknown) => void;
  const expired = new Promise<never>((_, reject) => {
    expire = reject;
  });
  const timer = setTimeout(() => {
    const err = new DeadlineError(label, ms);
    ac.abort(err);
    expire(err);
  }, ms);
  try {
    return await Promise.race([run(ac.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * One request, with a ceiling on how long it may stay quiet.
 *
 * The ceiling aborts rather than merely resolving early — nothing is left
 * reading a socket no one wants — and it reaches the caller as an ordinary
 * rejection, which is exactly what the tile retry loops already treat as
 * transient. An outer signal is relayed rather than replaced, so whichever
 * fires first wins and cancellation keeps working.
 *
 * The body is read *in here*, through `read`, and that is the point of the
 * shape rather than a convenience: `fetch` resolves on the response headers,
 * so a deadline that ends there covers the half of the transfer that is least
 * likely to hang and leaves `res.blob()` — the multi-megabyte half — with no
 * limit at all.
 */
export const fetchWithin = async <T>(
  url: string,
  { ms, what, signal }: { ms: number; what: string; signal?: AbortSignal },
  read: (res: Response) => Promise<T>,
): Promise<T> => {
  const ac = new AbortController();
  const relay = () => ac.abort(signal?.reason);
  if (signal?.aborted) relay();
  signal?.addEventListener('abort', relay);
  const timer = setTimeout(() => ac.abort(new DeadlineError(what, ms)), ms);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`${what} HTTP ${res.status}`);
    return await read(res);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
};
