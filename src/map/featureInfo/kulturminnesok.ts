import { useEffect, useReducer } from 'react';

export type KulturminnesokStatus = 'unknown' | 'indexed' | 'missing';

const RESOLVER_LINK = /\/ra\/lokalitet\/(\d+)(?:[/?#]|$)/;

const kulturminnesokId = (link: string): string =>
  link.match(RESOLVER_LINK)?.[1] ?? '';

const answers = new Map<string, KulturminnesokStatus>();
const inFlight = new Map<string, Promise<KulturminnesokStatus>>();

const probe = (id: string): Promise<KulturminnesokStatus> => {
  const pending = inFlight.get(id);
  if (pending) return pending;

  const request = (async (): Promise<KulturminnesokStatus> => {
    try {
      const res = await fetch(`/kms/api/v2/search/${encodeURIComponent(id)}`);
      if (!res.ok) return 'unknown';
      const body = (await res.json()) as { externalid?: string | null };
      return body?.externalid ? 'indexed' : 'missing';
    } catch {
      return 'unknown';
    }
  })();

  inFlight.set(id, request);
  void request.then((status) => {
    inFlight.delete(id);
    if (status !== 'unknown') answers.set(id, status);
  });
  return request;
};

export const useKulturminnesokStatus = (link: string): KulturminnesokStatus => {
  const id = kulturminnesokId(link);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!id || answers.has(id)) return;
    let live = true;
    void probe(id).then(() => {
      if (live) rerender();
    });
    return () => {
      live = false;
    };
  }, [id]);

  return (id && answers.get(id)) || 'unknown';
};
