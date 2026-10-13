import { useAtom, useAtomValue } from 'jotai';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import { useCallback, useEffect } from 'react';

import { mapAtom } from '../map/atoms';
import { cursorLease } from '../map/cursorLease';
import type { ProjectionIdentifier } from '../map/projections/types';
import { uiContextAtom } from '../shared/uiContext';
import {
  otherHoldOnMapAtom,
  placeInfoArmedAtom,
  placeReadingAtom,
} from './atoms';
import { placeAt, readPlaceAt, type PlaceReading } from './placeReading';

export interface PlaceInfo {
  armed: boolean;
  reading: PlaceReading | null;
  close: () => void;
}

export const usePlaceInfo = (): PlaceInfo => {
  const [armed, setArmed] = useAtom(placeInfoArmedAtom);
  const [reading, setReading] = useAtom(placeReadingAtom);
  const map = useAtomValue(mapAtom);
  const context = useAtomValue(uiContextAtom);
  const otherHold = useAtomValue(otherHoldOnMapAtom);

  const close = useCallback(() => setReading(null), [setReading]);

  useEffect(() => {
    if (context === 'map') return;
    setArmed(false);
    setReading(null);
  }, [context, setArmed, setReading]);

  useEffect(() => {
    if (otherHold) setArmed(false);
  }, [otherHold, setArmed]);

  useEffect(() => {
    if (!armed) return;
    const viewport = map.getViewport();
    const view = map
      .getView()
      .getProjection()
      .getCode() as ProjectionIdentifier;

    const cursor = cursorLease(viewport);
    cursor.set('crosshair');

    const onClick = (event: MapBrowserEvent) => {
      setArmed(false);
      setReading(placeAt(event.coordinate as [number, number], view));
    };

    map.on('singleclick', onClick);
    return () => {
      map.un('singleclick', onClick);
      cursor.release();
    };
  }, [armed, map, setArmed, setReading]);

  useEffect(() => {
    if (!reading?.busy) return;
    const query = new AbortController();
    void readPlaceAt(reading, query.signal)
      .then((full) => {
        if (!query.signal.aborted) setReading(full);
      })
      .catch(() => {
        if (!query.signal.aborted) setReading({ ...reading, busy: false });
      });
    return () => query.abort();
  }, [reading, setReading]);

  useEffect(() => {
    if (!armed && !reading) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (armed) setArmed(false);
      else setReading(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [armed, reading, setArmed, setReading]);

  return { armed, reading, close };
};
