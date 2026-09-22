// The short link, both directions.
//
// `/l/K7M2QX` is a Caddy `redir` to `/?lok=K7M2QX` and nothing more — the code
// is the key, so there is nothing to look up and no reason for the short form
// to be a service. This module is the client half: resolve the code on a cold
// load, move the map to what it named, and keep the parameter in step with
// whatever is open afterwards.

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

/**
 * Captured at module import, not read in the effect. The writer below removes
 * `lok` whenever nothing is open, and on a cold load that runs before the
 * reader has resolved anything — so a read at first render would race the
 * parameter out of existence.
 */
const bootCode = getUrlParameter('lok');

export const shareUrlOf = (code: string): string =>
  `${window.location.origin}/l/${code}`;

/** How close a followed link lands. Close enough to see the relief the spot is
 *  about, not so close that a mis-set pin is off the screen. */
const LINK_ZOOM = 16;

export const useSpotShareLink = () => {
  const map = useAtomValue(mapAtom);
  const user = useAtomValue(currentUserAtom);
  const active = useAtomValue(activeSpotAtom);
  const setActive = useSetAtom(activeSpotAtom);
  const setAuthDialogOpen = useSetAtom(isAuthDialogOpenAtom);
  const setAuthPrompt = useSetAtom(authPromptAtom);

  /** Whether the boot code has had its answer. Until it has, the writer stays
   *  out of the way — it must not delete the parameter it is about to read. */
  const settled = useRef(bootCode == null);

  /** The code still waiting on one. Held here rather than re-read off the URL,
   *  which the writer below owns from the moment this settles — a guest who was
   *  turned away keeps their retry either way. */
  const unresolved = useRef(bootCode);

  // Runs immediately (pb.authStore rehydrates at import, so the first request
  // already carries any stored token) and again whenever the user changes, so
  // signing in retries a code that a guest could not see.
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
        // Settled either way, so the writer below stops standing aside: a
        // reader who never gets an answer to this code should still have the
        // parameter follow whatever they open next.
        settled.current = true;
        if (user) {
          unresolved.current = null;
          removeUrlParameter('lok');
          console.warn('[spots] no spot for code', code);
          return;
        }
        // Signed out, and the server does not say which of the two this is: a
        // private spot the visitor may well own, or no spot at all. The sign-in
        // is the one useful answer to both, and it is also the retry — this
        // effect runs again with an account behind it. The parameter stays on
        // the URL for the same reason: a reload is the other way to retry.
        setAuthPrompt('spotLink');
        setAuthDialogOpen(true);
      });

    return () => {
      live = false;
    };
  }, [user, setActive, setAuthDialogOpen, setAuthPrompt]);

  // Move the map to whatever is open, keyed on the id: re-centring on every
  // field change would fight a reader who is panning around their own spot.
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
    // `activePoint` is an array literal off a fresh record, so naming it here
    // would re-animate on every realtime update of an unrelated field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, activeId]);

  // The parameter follows what is open, once the boot code has had its answer.
  const activeCode = active?.code ?? null;
  useEffect(() => {
    if (!settled.current) return;
    if (activeCode) setUrlParameter('lok', activeCode);
    else removeUrlParameter('lok');
  }, [activeCode]);
};

/** Copy a spot's link. Returns whether the clipboard took it. */
export const copyShareLink = async (spot: SpotRecord): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(shareUrlOf(spot.code));
    return true;
  } catch {
    return false;
  }
};
