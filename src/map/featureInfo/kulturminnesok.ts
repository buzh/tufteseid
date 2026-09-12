import { useEffect, useState } from 'react';

/*
 * Does the Kulturminnesøk link on a heritage feature go anywhere?
 *
 * Riksantikvaren serves `linkkulturminnesok` on every record in kulturminner2
 * and freda_bygninger, pointing at `kulturminnesok.no/ra/lokalitet/<id>`.
 * That URL is a resolver: it maps an Askeladden lokalitet id onto
 * Kulturminnesøk's own record uuid and redirects to `/kart/?q=<id>&id=<uuid>`.
 *
 * A fair share of the register is not in that index. Measured over every
 * lokalitet in two 2.4 km boxes (2026-09): 3 of 7 around Gimsø in Skien and
 * 4 of 18 around Borre. The misses look nothing like each other — automatisk
 * fredet and vedtaksfredet, gravfelt and prestegård, fylkeskommune and
 * Riksantikvaren as `opphav`, all `synlig=true` — so there is no field on the
 * wire that predicts one, which is why this has to be asked.
 *
 * And the miss is quiet. The resolver answers one it cannot map by echoing
 * the raw number back as `id=41826`, HTTP 200; the page then asks its own API
 * for that record and gets a 200 carrying an all-null shell typed
 * `brukerminne`. So the link opens a blank entry rather than a 404, and
 * nothing short of asking the same question tells you in advance.
 *
 * We ask it exactly the way the destination page does — same endpoint, same
 * id — and treat a null `externalid` as the miss. Same-origin through
 * wmscache (`/kms/*` in the Caddyfile), because the API sends no CORS
 * headers, and cached there for a week: a missing record is one reindex away
 * from existing.
 */

/** `unknown` covers "not asked yet", "not a resolver URL" and "ask failed". */
export type KulturminnesokStatus = 'unknown' | 'indexed' | 'missing';

/*
 * Only the numeric lokalitet resolver is checkable. Brukerminner link to
 * their own uuid and SEFRAK serves no link at all; both fall through to
 * `unknown`, which leaves the link unmarked — the right answer for a URL
 * whose shape we have not verified.
 */
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

/**
 * Status of one `linkkulturminnesok` URL. Returns `unknown` on the first
 * render and settles a moment later, so the link is shown immediately and
 * only *marked* once the answer is in — a slow or broken probe costs the
 * mark, never the link.
 */
export const useKulturminnesokStatus = (link: string): KulturminnesokStatus => {
  const id = kulturminnesokId(link);
  const [status, setStatus] = useState<KulturminnesokStatus>(
    () => (id ? (answers.get(id) ?? 'unknown') : 'unknown'),
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
