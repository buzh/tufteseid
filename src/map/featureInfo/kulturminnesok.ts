import { useEffect, useState } from 'react';

// RA serves `linkkulturminnesok` on every record, but part of the register is
// not in Kulturminnesøk's index and the miss is silent: HTTP 200 with an
// all-null body, so a null `externalid` is the miss. Same-origin through
// wmscache (`/kms/*`) because the API sends no CORS headers.

/** `unknown` covers "not asked yet", "not a resolver URL" and "ask failed". */
export type KulturminnesokStatus = 'unknown' | 'indexed' | 'missing';

// Only the numeric lokalitet resolver is checkable: brukerminner link to their
// own uuid and SEFRAK serves no link, so both fall through to `unknown`.
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
      // A dead probe must never be able to hide a link that works.
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

/** Status of one `linkkulturminnesok` URL. `unknown` on the first render, so a
 * slow or broken probe costs the mark and never the link. */
export const useKulturminnesokStatus = (link: string): KulturminnesokStatus => {
  const id = kulturminnesokId(link);
  const [status, setStatus] = useState<KulturminnesokStatus>(() =>
    id ? (answers.get(id) ?? 'unknown') : 'unknown',
  );

  useEffect(() => {
    if (!id) {
      setStatus('unknown');
      return;
    }
    const known = answers.get(id);
    if (known) {
      setStatus(known);
      return;
    }
    let live = true;
    setStatus('unknown');
    void probe(id).then((next) => {
      if (live) setStatus(next);
    });
    return () => {
      live = false;
    };
  }, [id]);

  return status;
};
