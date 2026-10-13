import {
  mayRequest,
  reportFailure,
  reportStatus,
  UpstreamDownError,
} from '../../upstream/health';
import { originForUrl } from '../../upstream/origins';

export class DeadlineError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} exceeded its ${Math.round(ms / 1000)} s deadline`);
    this.name = 'DeadlineError';
  }
}

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
  let answered = false;
  try {
    const res = await fetch(url, { signal: ac.signal });
    answered = true;
    if (origin) reportStatus(origin, res.status);
    if (!res.ok) throw new Error(`${what} HTTP ${res.status}`);
    return await read(res);
  } catch (err) {
    if (origin && !answered && !signal?.aborted) reportFailure(origin);
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
};
