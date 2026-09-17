/*
 * Both directions of `?lok=CODE`, in one module so reader and writer cannot
 * disagree about when the parameter may be removed. The link carries the code
 * and no viewport, and nothing here writes `editingLocalityIdAtom`, so a
 * followed link lands in show. Sign-in is offered only on the miss.
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

// Captured at import: the writer removes `lok` whenever nothing is open, so
// reading it during the first render races it.
const bootCode = getUrlParameter('lok');

// `/l/K7M2QX`, a `redir` in our Caddyfile to the long spelling the app writes.
export const shareUrlOf = (code: string): string =>
  `${window.location.origin}/l/${code}`;

// A link to a non-public lokalitet answers "finner ikke" for everyone but its
// owner, so warn on copy. `limited` gets the private wording.
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

/** Both directions of `?lok=`. Mount once, from `useMapSideEffects`. */
export const useLocalityShareLink = () => {
  const active = useAtomValue(activeLocalityAtom);
  const setActive = useSetAtom(activeLocalityAtom);
  const user = useAtomValue(currentUserAtom);
  const openAuthDialog = useSetAtom(isAuthDialogOpenAtom);

  // Resolved, failed for good, or never existed. Until it settles the writer
  // holds off rather than clearing the parameter; a guest's miss never settles.
  const settled = useRef(bootCode == null);
  const activeCode = active?.code ?? null;

  // Tries immediately — `pb.authStore` rehydrates at import, so the first
  // request carries any token — and again on a user change, so sign-in retries.
  useEffect(() => {
    if (!bootCode || settled.current) return;
    const code = bootCode;
    getLocalityByCode(code)
      .then((rec) => {
        settled.current = true;
        setActive(rec);
      })
      .catch((err) => {
        // A later attempt got there first.
        if (settled.current) return;
        console.warn('[shareLink] deep link failed', code, err);
        // One message for both: the API cannot tell a dead code from a hidden one.
        const title = t('localities.share.notFound', {
          code: code.toUpperCase(),
        });
        if (!user) {
          // The guest may be the signed-out owner: keep the code, stay unsettled.
          toast.warning({
            title,
            description: t('localities.share.notFoundSignIn'),
            action: {
              label: t('auth.signIn'),
              onClick: () => openAuthDialog(true),
            },
            duration: 10000,
          });
          return;
        }
        settled.current = true;
        toast.warning({
          title,
          description: t('localities.share.notFoundHint'),
        });
        removeUrlParameter('lok');
      });
  }, [user, setActive, openAuthDialog]);

  // Keyed on the code, so a re-fetch of the same lokalitet leaves the URL alone.
  useEffect(() => {
    if (!settled.current) return;
    if (activeCode) setUrlParameter('lok', activeCode);
    else removeUrlParameter('lok');
  }, [activeCode]);
};
