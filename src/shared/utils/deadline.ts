// `fetch` has no time limit of its own, and the retry loops are driven by
// rejections, so a socket that goes quiet never produces one. The pin queue
// runs one job at a time: one stalled request parks the single worker and
// every card behind it spins. `fetchWithin` bounds one request, turning a
// stall back into the transient error the retry loops handle; `withDeadline`
// bounds a whole piece of work however it is made of.

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
