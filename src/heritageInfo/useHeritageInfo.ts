// One GetFeatureInfo per ticked register against `kart.ra.no`, so the hover
// fires only from a pointer at rest. Touch is skipped: a tap is a click there,
// and a tip with no pointer to leave with would never come down.

import { getDefaultStore, useAtom, useAtomValue } from 'jotai';
import { unByKey } from 'ol/Observable';
import { useCallback, useEffect, useState } from 'react';
import { mapAtom } from '../map/atoms';
import { cursorLease } from '../map/cursorLease';
import { heritagePopupAtom, heritageTipAtom } from '../map/featureInfo/atoms';
import {
  heritageIsQueryable,
  queryHeritageAt,
} from '../map/featureInfo/heritageQuery';
import type { FeatureInfoReading } from '../map/featureInfo/types';
import { spotFootprintAdjustingAtom, spotPlacingAtom } from '../spots/atoms';
import { spotAtPixel } from '../spots/hitTest';
import { terrainAdjustingAtom } from '../terrain/window';

/** How long the pointer has to hold still before a hover asks. */
const REST_MS = 220;

/** Any gesture that has taken the map: the terrain rectangle, a spot's
 *  footprint, or an armed pin. */
const placingOnMap = (): boolean => {
  const store = getDefaultStore();
  return (
    store.get(terrainAdjustingAtom) ||
    store.get(spotFootprintAdjustingAtom) ||
    store.get(spotPlacingAtom)
  );
};

export interface HeritageInfo {
  tip: FeatureInfoReading | null;
  popup: FeatureInfoReading | null;
  /** Map coordinate of a click still waiting on an answer. */
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

    // Leased, because the pin and the terrain rectangle write the cursor too.
    const cursor = cursorLease(viewport);
    const setHit = (hit: boolean) => {
      cursor.set(hit ? 'pointer' : null);
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
        // Placing a rectangle or a pin owns the pointer. Read from the store,
        // not as a dependency, so turning one on does not rebind these
        // listeners.
        if (placingOnMap()) {
          forget();
          return;
        }
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
              // No tip while the card for the same spot is open.
              const open = store.get(heritagePopupAtom);
              const sameSpot =
                open !== null &&
                reading !== null &&
                open.coordinate[0] === reading.coordinate[0] &&
                open.coordinate[1] === reading.coordinate[1];
              setTip(sameSpot ? null : reading);
            })
            .catch(() => {
              setHit(false);
            });
        }, REST_MS);
      }),

      map.on('singleclick', (e) => {
        if (!heritageIsQueryable(map)) return;
        // A click placing a pin or a rectangle, or landing on a pin, belongs to
        // whatever is being placed.
        if (placingOnMap()) return;
        if (spotAtPixel(map, e.pixel)) return;
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
            // A null reading closes what was open.
            setPopup(reading);
          })
          .catch(() => {
            if (!query.signal.aborted) setPending(null);
          });
      }),

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
      cursor.release();
    };
  }, [map, setTip, setPopup]);

  return { tip, popup, pending, closePopup };
};
