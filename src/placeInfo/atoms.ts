import { atom } from 'jotai';

import {
  releaseSpotFootprintAtom,
  spotFootprintAdjustingAtom,
  spotPlacingAtom,
} from '../spots/atoms';
import { terrainAdjustingAtom } from '../terrain/window';
import type { PlaceReading } from './placeReading';

/** The button is armed: the next click on the map is a lookup, not a reading
 *  of whatever is drawn there. */
export const placeInfoArmedAtom = atom(false);

/** Whatever else owns the next click on the map. Read rather than subscribed
 *  to where turning one on must not rebind a listener. */
export const otherHoldOnMapAtom = atom(
  (get) =>
    get(spotPlacingAtom) ||
    get(spotFootprintAdjustingAtom) ||
    get(terrainAdjustingAtom),
);

/** Arming takes the map off whatever had it, the way `setSpotStageAtom` takes
 *  it off the terrain rectangle. */
export const armPlaceInfoAtom = atom(null, (_get, set, armed: boolean) => {
  if (armed) {
    set(spotPlacingAtom, false);
    set(terrainAdjustingAtom, false);
    set(releaseSpotFootprintAtom);
  }
  set(placeInfoArmedAtom, armed);
});

/** What the last lookup found, or is still finding. */
export const placeReadingAtom = atom<PlaceReading | null>(null);
