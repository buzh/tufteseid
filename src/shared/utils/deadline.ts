// `fetch` has no time limit of its own, and the retry loops are driven by
// rejections, so a socket that goes quiet never produces one. The pin queue
// runs one job at a time: one stalled request parks the single worker and
// every card behind it spins. `fetchWithin` bounds one request, turning a
// stall back into the transient error the retry loops handle; `withDeadline`
// bounds a whole piece of work however it is made of.

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

// Settles on time whether or not `run` honours the signal.
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

// The body is read in here, through `read`, because `fetch` resolves on the
// headers: a deadline that ended there would leave the multi-megabyte half of
// the transfer unbounded. An outer signal is relayed, not replaced.
//
// It is also where every non-tile request to an external service passes, so it
// is where those meet the breaker (`src/upstream/`): a request to an origin
// that is not answering is not made, and one that is made is evidence either
// way. Tiles have their own path through `guardTileSource`, because they are
// not fetched by us at all — the browser loads them off an `<img>`.
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
  // Once a status line is in, that is the verdict; anything after it — a 404
  // we throw on, a body `read` chokes on — has already been reported, and
  // reporting it twice would contradict the first answer.
  let answered = false;
  try {
    const res = await fetch(url, { signal: ac.signal });
    answered = true;
    if (origin) reportStatus(origin, res.status);
    if (!res.ok) throw new Error(`${what} HTTP ${res.status}`);
    return await read(res);
  } catch (err) {
    // A caller that cancelled says nothing about the service — a pan that
    // outran its own lookup is not an outage, and counting it as one would
    // trip the breaker on three fast pans. Our own deadline and a network
    // error do count.
    if (origin && !answered && !signal?.aborted) reportFailure(origin);
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
};
