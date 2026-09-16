/*
 * Sharing a lokalitet — the link, and the boot that follows one
 * (docs/lokalitet-view.md §10, docs/ui-architecture.md §4.3).
 *
 * Both directions of one fact live here on purpose. "Which lokalitet is open"
 * is written into the URL as `?lok=CODE` and read back out of it on a cold
 * load, and those two halves have to agree about spelling, about case, and
 * about *when* the parameter may be removed. Split across two modules they
 * would agree until the first time one of them changed.
 *
 * Three decisions the rest of this file implements:
 *
 * - **The code, not the id.** `?lok=K7M2QX` is six characters somebody can
 *   read down a phone; `?lok=8f2k1p9qzx7c4nv` is a database key that happens
 *   to be in a URL. The code already exists for exactly this (§11), survives
 *   a rename and a `Juster området`, and is what a report to Riksantikvaren
 *   cites — so the link and the citation are the same string.
 * - **The link carries no viewport.** No `lat`, no `lon`, no `zoom` of the
 *   sender's — the workspace fits the map to the rectangle when it mounts
 *   (`zoomToLocality`, keyed on the record id), so a shared link frames the
 *   lokalitet by construction. Pinning the sender's viewport into it would
 *   mean a link that opens somewhere else the day the rectangle is adjusted.
 * - **A link opens in `show`, whoever follows it.** Nothing here writes
 *   `editingLocalityIdAtom`, and that is the whole of the enforcement: stance
 *   is keyed on a record id that starts null, so "opens in show" holds by
 *   construction rather than by this module remembering to say so (§2).
 */

import { t } from 'i18next';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { getLocalityByCode, type LocalityRecord } from '../api/localities';
import { currentUserAtom } from '../auth/atoms';
import { isAuthDialogOpenAtom } from '../auth/atoms-dialog';
import {
  getUrlParameter,
  removeUrlParameter,
  setUrlParameter,
} from '../shared/utils/urlUtils';
import { toast } from '../ui';
import { activeLocalityAtom } from './atoms';

/*
 * The code as it arrived, captured at import time.
 *
 * Module scope rather than inside the hook, and that is load-bearing: the
 * writer below removes `lok` whenever no lokalitet is open, and on a cold
 * load nothing is open yet. Read the parameter during the first render and
 * the writer has already deleted it; read it at import, before React has run
 * at all, and the two cannot race.
 */
const bootCode = getUrlParameter('lok');

/**
 * `/l/K7M2QX` — the short URL, which is a route on our own Caddy rather than
 * a service. It redirects to `/?lok=K7M2QX`; the app only ever writes the
 * long spelling, so there is exactly one form to keep working.
 */
export const shareUrlOf = (code: string): string =>
  `${window.location.origin}/l/${code}`;

/**
 * `Del` — the clipboard write and the sentence that goes with it.
 *
 * The sentence is the point. Visibility is set in Detaljer, once, months
 * before anybody shares anything, and a link to a `private` lokalitet is a
 * link that answers "finner ikke" for everyone who is not its owner. Saying
 * so at the moment the link is copied is the only place that lands — and it
 * is a `warning` rather than a refusal, because copying the link to a record
 * you are about to publish is a perfectly ordinary order of operations.
 *
 * `limited` gets the private wording: it is a placeholder behaving as
 * `private` until groups exist, and the toast has to describe what the server
 * will actually do.
 */
export const copyShareLink = (locality: LocalityRecord) => {
  const url = shareUrlOf(locality.code);
  void navigator.clipboard.writeText(url);
  if (locality.visibility === 'public') {
    toast.success({
      title: t('localities.share.copied'),
      description: t('localities.share.copiedPublic'),
      duration: 4000,
    });
  } else {
    toast.warning({
      title: t('localities.share.copied'),
      description: t('localities.share.copiedPrivate'),
      duration: 6000,
    });
  }
};

/**
 * Both directions of `?lok=`. Mount once, from `useMapSideEffects`.
 */
export const useLocalityShareLink = () => {
  const active = useAtomValue(activeLocalityAtom);
  const setActive = useSetAtom(activeLocalityAtom);
  const user = useAtomValue(currentUserAtom);
  const openAuthDialog = useSetAtom(isAuthDialogOpenAtom);

  /*
   * Has the deep link finished — resolved, failed, or never existed?
   *
   * Until it has, the writer holds off rather than clearing the parameter,
   * so a reader stuck at the sign-in wall still has the link in their address
   * bar. Reloading the page during sign-in must not be what loses it.
   */
  const settled = useRef(bootCode == null);
  const activeCode = active?.code ?? null;

  // The reader. Runs again when the user arrives, which is how the sign-in
  // wall works: a guest gets the dialog and the code waits in `bootCode`
  // until `currentUserAtom` fills in.
  useEffect(() => {
    if (!bootCode || settled.current) return;
    if (!user) {
      // The read rules require auth even for a `public` lokalitet, so there
      // is nothing to try yet — and asking PB first would answer 404 for the
      // wrong reason. Not settled: the code is still owed to whoever signs in.
      openAuthDialog(true);
      return;
    }
    settled.current = true;
    const code = bootCode;
    getLocalityByCode(code)
      .then((rec) => setActive(rec))
      .catch((err) => {
        console.warn('[shareLink] deep link failed', code, err);
        // Deliberately one message for both a code that names nothing and a
        // lokalitet this reader may not see: the API cannot tell them apart
        // (getLocalityByCode) and neither should the interface.
        toast.warning({
          title: t('localities.share.notFound', { code: code.toUpperCase() }),
          description: t('localities.share.notFoundHint'),
        });
        removeUrlParameter('lok');
      });
  }, [user, setActive, openAuthDialog]);

  // The writer. The code rather than the record, so re-fetching the same
  // lokalitet does not rewrite the URL.
  useEffect(() => {
    if (!settled.current) return;
    if (activeCode) setUrlParameter('lok', activeCode);
    else removeUrlParameter('lok');
  }, [activeCode]);
};
