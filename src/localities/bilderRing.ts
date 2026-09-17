import { atom, useAtomValue } from 'jotai';
import { focusedHalfAtom } from '../map/compare/halves';

// A/D walks the bilder rail, taking the keys off the LiDAR style ring. It
// declines in three cases and `useGroundMode` falls through to that ring in
// each: no rail worth walking, a live picker run, the compare curtain's B half.

export type BilderRing = {
  /** `stripNavigable` minus a live picker run, which this listener never hears
   * about from `useWorkspaceKeys`. */
  walkable: boolean;
  /** Steps the cursor, wrapping. A stable delegate over a ref: the real
   * `stepBilde` changes whenever the rail moves. */
  step: (delta: 1 | -1) => void;
};

/** Null whenever no lokalitet is open. */
export const bilderRingAtom = atom<BilderRing | null>(null);

/** Who has A/D now: the third decline, the curtain's B half, is added here. */
export const bilderRingHasKeysAtom = atom(
  (get) =>
    (get(bilderRingAtom)?.walkable ?? false) && get(focusedHalfAtom) === 'a',
);

const RING_HINT = ' · A/D';

// Composed rather than translated, so the hint moves with the keys.
export const useLidarStyleRingHint = () =>
  useAtomValue(bilderRingHasKeysAtom) ? '' : RING_HINT;

/** Returns whether the rail was walked, so `useGroundMode` can fall through. */
export const cycleBilderAtom = atom(
  null,
  (get, _set, step: 1 | -1): boolean => {
    if (!get(bilderRingHasKeysAtom)) return false;
    get(bilderRingAtom)?.step(step);
    return true;
  },
);
