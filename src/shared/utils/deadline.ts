import {
  mayRequest,
  reportFailure,
  reportStatus,
  UpstreamDownError,
} from '../../upstream/health';
import { originForUrl } from '../../upstream/origins';

// Passed as the abort reason too, so a console says which budget was blown
// rather than "signal is aborted without reason".
export class DeadlineError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} exceeded its ${Math.round(ms / 1000)} s deadline`);
    this.name = 'DeadlineError';
  }
}

/**
 * A whole piece of work bounded, however it is made up — `fetchWithin` bounds
 * one request, this bounds a stitch of hundreds. Settles on time whether or not
 * `run` honours the signal.
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

// The body is read through `read` inside the deadline: `fetch` resolves on the
// headers, so ending there would leave the transfer unbounded. Also the
// admission point for the upstream breaker (`src/upstream/`).
export const fetchWithin = async <T>(
  url: string,
  { ms, what, signal }: { ms: number; what: string; signal?: AbortSignal },
  read: (res: Response) => Promise<T>,
): Promise<T> => {
  const origin = originForUrl(url);
  if (origin && !mayRequest(origin)) throw new UpstreamDownError(what, origin);

  const ac = new AbortController();
  const relay = () => ac.abort(signal?.reason);
  if (signal?.aborted) relay();
  signal?.addEventListener('abort', relay);
  const timer = setTimeout(() => ac.abort(new DeadlineError(what, ms)), ms);
  // Once a status line is in, that is the verdict; a later throw must not
  // report the origin a second time.
  let answered = false;
  try {
    const res = await fetch(url, { signal: ac.signal });
    answered = true;
    if (origin) reportStatus(origin, res.status);
    if (!res.ok) throw new Error(`${what} HTTP ${res.status}`);
    return await read(res);
  } catch (err) {
    // A caller-side abort is not evidence about the service; our own deadline
    // and a network error are.
    if (origin && !answered && !signal?.aborted) reportFailure(origin);
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
};
