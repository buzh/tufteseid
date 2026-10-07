// `/l/<code>` is a Caddy `redir` to `/?lok=<code>`; this is the client half.

import { atom, useAtomValue, useSetAtom } from 'jotai';
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
import { activeSpotAtom, spotReadingAtom } from './atoms';

// Read at import: the writer effect below deletes `lok` on first render, so a
// later read would race the parameter out of existence.
const bootCode = getUrlParameter('lok');

export const shareUrlOf = (code: string): string =>
  `${window.location.origin}/l/${code}`;

const LINK_ZOOM = 16;

/** A code that answered with nothing, for `SpotLinkFailed` to say so. Only a
 *  signed-in reader ever sets it: signed out, the same 404 raises the sign-in
 *  box instead, because a private spot and a missing one are indistinguishable
 *  from outside. */
export const spotLinkFailedAtom = atom(false);

/** Nothing in the notice is to be acted on, so it goes by itself rather than
 *  asking to be dismissed. Long enough to be read after the eye has finished
 *  wondering why the map did not move. The deadline is armed here and not in
 *  `SpotLinkFailed`, whose surface is swapped out for the whole time a spot is
 *  being placed — a timer living there would rewind. */
const LINK_FAILED_MS = 10000;

export const useSpotShareLink = () => {
  const map = useAtomValue(mapAtom);
  const user = useAtomValue(currentUserAtom);
  const active = useAtomValue(activeSpotAtom);
  const setActive = useSetAtom(activeSpotAtom);
  const setReading = useSetAtom(spotReadingAtom);
  const setAuthDialogOpen = useSetAtom(isAuthDialogOpenAtom);
  const setAuthPrompt = useSetAtom(authPromptAtom);
  const setLinkFailed = useSetAtom(spotLinkFailedAtom);

  /** Until the boot code has its answer the writer effect below must not
   *  delete the parameter. */
  const settled = useRef(bootCode == null);
  const unresolved = useRef(bootCode);

  // Re-runs on a change of user, so signing in retries a code a guest could
  // not see.
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
        // No-op for a reader who may not edit — the reading is the only thing
        // they get. An owner following their own link lands in it too, and
        // `EvidenceReader` steps back to their card if there is nothing to read.
        setReading(true);
      })
      .catch((err) => {
        if (!live) return;
        // Only a 404 says the code is not this reader's to see; the SDK gives a
        // dropped or timed-out request status 0. Neither settled nor cleared
        // off the URL for one of those, so a reload is still a retry.
        if ((err as { status?: number })?.status !== 404) {
          console.warn('[spots] could not resolve the code', code, err);
          return;
        }
        settled.current = true;
        if (user) {
          unresolved.current = null;
          removeUrlParameter('lok');
          setLinkFailed(true);
          // Unguarded by `live`: this branch nulls `unresolved` before arming,
          // so there is never a second notice for the timer to cut short.
          window.setTimeout(() => setLinkFailed(false), LINK_FAILED_MS);
          console.warn('[spots] no spot for code', code);
          return;
        }
        // A private spot and a missing one are the same 404, so signed out the
        // sign-in is both answer and retry. `lok` stays on the URL to survive a
        // reload.
        setAuthPrompt('spotLink');
        setAuthDialogOpen(true);
      });

    return () => {
      live = false;
    };
  }, [
    user,
    setActive,
    setReading,
    setAuthDialogOpen,
    setAuthPrompt,
    setLinkFailed,
  ]);

  // Read by the centring effect below without being one of its dependencies:
  // `EvidenceReader` fits the footprint when a reading opens, so centring on
  // the point as well would be two animations on one view, and leaving a
  // reading must not move the view at all. Only a spot that has a rectangle
  // gets that fit, though — so a reading without one is centred here instead,
  // or a link to a row from before the rectangle rule would leave the view
  // wherever the reader last had it.
  const reading = useAtomValue(spotReadingAtom);
  const readingNow = useRef(reading);
  useEffect(() => {
    readingNow.current = reading;
  }, [reading]);

  // Keyed on the id: re-centring on every field change would fight a reader
  // panning around their own spot.
  const activeId = active?.id ?? null;
  const activePoint = active?.point;
  const activeFitsItself = active?.footprint != null;
  useEffect(() => {
    if (!activeId || !activePoint || (readingNow.current && activeFitsItself))
      return;
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
    // re-animate on every realtime update of an unrelated field. Nor
    // `activeFitsItself`, or the card's repair write landing a rectangle would
    // animate a second time over a reader already looking at the place.
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
export const copyShareLink = async (
  spot: SpotRecord | null,
): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(
      spot ? shareUrlOf(spot.code) : window.location.href,
    );
    return true;
  } catch {
    return false;
  }
};
