import { atom } from 'jotai';

import {
  releaseSpotFootprintAtom,
  spotFootprintAdjustingAtom,
  spotPlacingAtom,
} from '../spots/atoms';
import { terrainAdjustingAtom } from '../terrain/window';
import type { PlaceReading } from './placeReading';

export const placeInfoArmedAtom = atom(false);

export const otherHoldOnMapAtom = atom(
  (get) =>
    get(spotPlacingAtom) ||
    get(spotFootprintAdjustingAtom) ||
    get(terrainAdjustingAtom),
);

export const armPlaceInfoAtom = atom(null, (_get, set, armed: boolean) => {
  if (armed) {
    set(spotPlacingAtom, false);
    set(terrainAdjustingAtom, false);
    set(releaseSpotFootprintAtom);
  }
  set(placeInfoArmedAtom, armed);
});

export const placeReadingAtom = atom<PlaceReading | null>(null);
