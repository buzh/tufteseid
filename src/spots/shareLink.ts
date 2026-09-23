// `/l/<code>` is a Caddy `redir` to `/?lok=<code>`; this is the client half.

import { useAtomValue, useSetAtom } from 'jotai';
import { transform } from 'ol/proj';
import { useEffect, useRef } from 'react';

import { getSpotByCode, type SpotRecord } from '../api/spots';
import {
  authPromptAtom,
  currentUserAtom,
  isAuthDialogOpenAtom,
} from '../auth/atoms';
import { mapAtom } from '../map/atoms';
import {
  getUrlParameter,
  removeUrlParameter,
  setUrlParameter,
} from '../shared/utils/urlUtils';
import { activeSpotAtom } from './atoms';

// Read at import: the writer effect below deletes `lok` on first render, so a
// read at that point would race the parameter out of existence.
const bootCode = getUrlParameter('lok');

export const shareUrlOf = (code: string): string =>
  `${window.location.origin}/l/${code}`;

const LINK_ZOOM = 16;

export const useSpotShareLink = () => {
  const map = useAtomValue(mapAtom);
  const user = useAtomValue(currentUserAtom);
  const active = useAtomValue(activeSpotAtom);
  const setActive = useSetAtom(activeSpotAtom);
  const setAuthDialogOpen = useSetAtom(isAuthDialogOpenAtom);
  const setAuthPrompt = useSetAtom(authPromptAtom);

  /** Whether the boot code has had its answer; until then the writer effect
   *  must not delete the parameter. */
  const settled = useRef(bootCode == null);
  const unresolved = useRef(bootCode);

  // Re-runs on a change of user, so signing in retries a code a guest could
  // not see. pb.authStore rehydrates at import, so the first run carries any
  // stored token.
  useEffect(() => {
    const code = unresolved.current;
    if (!code) return;
    let live = true;

    getSpotByCode(code)
      .then((record) => {
        if (!live) return;
        unresolved.current = null;
        settled.current = true;
        setActive(record);
      })
      .catch(() => {
        if (!live) return;
        settled.current = true;
        if (user) {
          unresolved.current = null;
          removeUrlParameter('lok');
          console.warn('[spots] no spot for code', code);
          return;
        }
        // The server answers a private spot and a missing one with the same
        // 404, so signed out the sign-in is both the answer and the retry.
        // `lok` stays on the URL so a reload retries too.
        setAuthPrompt('spotLink');
        setAuthDialogOpen(true);
      });

    return () => {
      live = false;
    };
  }, [user, setActive, setAuthDialogOpen, setAuthPrompt]);

  // Keyed on the id: re-centring on every field change would fight a reader
  // panning around their own spot.
  const activeId = active?.id ?? null;
  const activePoint = active?.point;
  useEffect(() => {
    if (!activeId || !activePoint) return;
    const view = map.getView();
    view.animate({
      center: transform(
        activePoint,
        'EPSG:4326',
        view.getProjection().getCode(),
      ),
      zoom: Math.max(view.getZoom() ?? 0, LINK_ZOOM),
      duration: 400,
    });
    // `activePoint` is a fresh array literal per record: naming it would
    // re-animate on every realtime update of an unrelated field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, activeId]);

  const activeCode = active?.code ?? null;
  useEffect(() => {
    if (!settled.current) return;
    if (activeCode) setUrlParameter('lok', activeCode);
    else removeUrlParameter('lok');
  }, [activeCode]);
};

/** Returns whether the clipboard took it. */
export const copyShareLink = async (spot: SpotRecord): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(shareUrlOf(spot.code));
    return true;
  } catch {
    return false;
  }
};
