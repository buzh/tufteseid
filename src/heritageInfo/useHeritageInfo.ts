// When the Kulturminner layers are asked, and what the two surfaces do with the
// answer.
//
// The cost is the whole design here. Every question is one GetFeatureInfo per
// ticked register against `kart.ra.no`, the slowest origin in the stack, so the
// hover only fires from a pointer **at rest**: a sweep across the map costs
// nothing, and a reader who stops on a mound has already said what they want to
// know. `heritageQuery.ts` snaps the pixel and shares a memo between hover and
// click, so a click on a spot just hovered is free, and a hand holding almost
// still asks once.
//
// Touch is left out. A tap is a click there, and a tip with no pointer to leave
// with would sit over the map until the next one.

import { getDefaultStore, useAtom, useAtomValue } from 'jotai';
import { unByKey } from 'ol/Observable';
import { useCallback, useEffect, useState } from 'react';
import { mapAtom } from '../map/atoms';
import { heritagePopupAtom, heritageTipAtom } from '../map/featureInfo/atoms';
import {
  heritageIsQueryable,
  queryHeritageAt,
} from '../map/featureInfo/heritageQuery';
import type { FeatureInfoReading } from '../map/featureInfo/types';

/** How long the pointer has to hold still. Long enough that crossing the map
 *  asks nothing, short enough that stopping to look feels answered. */
const REST_MS = 220;

export interface HeritageInfo {
  tip: FeatureInfoReading | null;
  popup: FeatureInfoReading | null;
  /** Where a click is waiting on an answer, so the wait has somewhere to show. */
  pending: [number, number] | null;
  closePopup: () => void;
}

export const useHeritageInfo = (): HeritageInfo => {
  const [tip, setTip] = useAtom(heritageTipAtom);
  const [popup, setPopup] = useAtom(heritagePopupAtom);
  const [pending, setPending] = useState<[number, number] | null>(null);
  const map = useAtomValue(mapAtom);

  const closePopup = useCallback(() => setPopup(null), [setPopup]);

  useEffect(() => {
    const store = getDefaultStore();
    const viewport = map.getViewport();
    let restTimer: ReturnType<typeof setTimeout> | undefined;
    let hoverQuery: AbortController | null = null;
    let clickQuery: AbortController | null = null;

    // The cursor is the only thing that says a feature is clickable before it is
    // clicked, so it is set from the hover's answer rather than guessed.
    const setHit = (hit: boolean) => {
      viewport.style.cursor = hit ? 'pointer' : '';
    };

    const stopHovering = () => {
      if (restTimer !== undefined) clearTimeout(restTimer);
      restTimer = undefined;
      hoverQuery?.abort();
      hoverQuery = null;
    };

    const forget = () => {
      stopHovering();
      setTip(null);
      setHit(false);
    };

    const keys = [
      map.on('pointermove', (e) => {
        if (e.dragging) return;
        if ((e.originalEvent as PointerEvent).pointerType === 'touch') return;
        stopHovering();
        setTip(null);
        if (!heritageIsQueryable(map)) {
          setHit(false);
          return;
        }
        const pixel: [number, number] = [e.pixel[0], e.pixel[1]];
        restTimer = setTimeout(() => {
          const query = new AbortController();
          hoverQuery = query;
          void queryHeritageAt(map, pixel, query.signal)
            .then((reading) => {
              if (query.signal.aborted) return;
              setHit(reading !== null);
              // Nothing to say twice: while the card for this very spot is
              // open, a tip repeating it only covers the ground beside it.
              const open = store.get(heritagePopupAtom);
              const sameSpot =
                open !== null &&
                reading !== null &&
                open.coordinate[0] === reading.coordinate[0] &&
                open.coordinate[1] === reading.coordinate[1];
              setTip(sameSpot ? null : reading);
            })
            .catch(() => {
              // An origin that will not answer is the upstream chip's to report.
              setHit(false);
            });
        }, REST_MS);
      }),

      map.on('singleclick', (e) => {
        if (!heritageIsQueryable(map)) return;
        stopHovering();
        setTip(null);
        clickQuery?.abort();
        const query = new AbortController();
        clickQuery = query;
        const pixel: [number, number] = [e.pixel[0], e.pixel[1]];
        setPending(map.getCoordinateFromPixel(pixel) as [number, number]);
        void queryHeritageAt(map, pixel, query.signal)
          .then((reading) => {
            if (query.signal.aborted) return;
            setPending(null);
            // A null reading closes what was open: clicking bare ground beside
            // a card is how a reader puts it down.
            setPopup(reading);
          })
          .catch(() => {
            if (!query.signal.aborted) setPending(null);
          });
      }),

      // Panning is reading the map, not pointing at it.
      map.on('movestart', forget),
    ];

    const onLeave = () => forget();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      forget();
      setPopup(null);
    };
    viewport.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      unByKey(keys);
      viewport.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKeyDown);
      stopHovering();
      clickQuery?.abort();
      viewport.style.cursor = '';
    };
  }, [map, setTip, setPopup]);

  return { tip, popup, pending, closePopup };
};
