import { atom, useAtomValue } from 'jotai';
import { focusedHalfAtom } from '../map/compare/halves';

/*
 * A/D over the bilder rail — walking the exhibit from the keyboard.
 *
 * The rail along the bottom edge is the lokalitet's sequence of images, and
 * ←/→ have always walked it (§4.3). Those keys are borrowed, though: they are
 * OpenLayers' horizontal pan, given up only while there is a strip open with
 * more than one frame on it, and they are also the one pair of arrows a hand
 * already on the map is using for something else. A/D are the letter keys the
 * rest of this app reserves for *stepping a list* — every ground's style ring
 * is A/D, every dataset ring is W/S — so the rail gets them too, on the same
 * gate as the arrows, and the two spellings stay the same gesture.
 *
 * With W/S already reassigned to `[Visning ▾]` inside a lokalitet
 * (`src/shell/visningRing.ts`), that makes the two pairs read together: W/S
 * chooses which reading of the rectangle is on the ground, A/D walks the
 * exhibit the lokalitet keeps of it. Both of them go through `selectBilde`
 * and `selectVisning`, so the pointer, the rail cursor and the keys cannot
 * end up describing different pictures.
 *
 * **What it costs.** A/D is the LiDAR style ring, and inside a lokalitet with
 * a rail it stops being — exactly as the dataset ring stopped owning W/S. The
 * styles are a pulldown and a pulldown is reachable; a rail whose only
 * keyboard is a pair of keys the map is fighting over is not. The pulldown's
 * heading says which of the two has the keys right now
 * (`useLidarStyleRingHint`), for the reason `visningRing`'s `RING_HINT`
 * exists: a heading promising a shortcut that has moved is worse than no
 * heading.
 *
 * Published from `useLocalityWorkspace` and read from `useGroundMode`, which
 * is the `groundHandle.ts` gap again — the cycling keys are registered once,
 * up in row 1, and the rail is a lokalitet surface at the other edge of the
 * screen.
 */

/** The rail, as the two things stepping it from row 1 needs. */
export type BilderRing = {
  /**
   * Whether there is a rail on screen worth walking — the `stripNavigable`
   * the arrow keys are gated on, so the two spellings cannot disagree about
   * whether the strip is theirs, and one condition more: a live picker run
   * stands the arrows down inside `useWorkspaceKeys` and has to stand A/D
   * down from out here, since this listener never hears about it.
   */
  walkable: boolean;
  /**
   * Step the cursor, wrapping. A **stable delegate over a ref**, for the
   * reason `groundHandle.ts` gives: the real `stepBilde` closes over the item
   * list and the current cursor, so it is a new function every time the rail
   * moves, and putting that straight in the atom would be a store write per
   * keypress.
   */
  step: (delta: 1 | -1) => void;
};

/** Null whenever no lokalitet is open. */
export const bilderRingAtom = atom<BilderRing | null>(null);

/**
 * Who has A/D at this moment. The B half of the compare curtain keeps its own
 * ground's style ring, for the same reason it keeps its own dataset ring: the
 * whole point of `C A A C` is walking the *focused* half.
 */
export const bilderRingHasKeysAtom = atom(
  (get) =>
    (get(bilderRingAtom)?.walkable ?? false) && get(focusedHalfAtom) === 'a',
);

const RING_HINT = ' · A/D';

/**
 * For the LiDAR style pulldown: the hint, unless the rail has taken the keys.
 *
 * Composed rather than translated, like `visningRing`'s — one string to keep
 * in three languages, and it moves with the keys. There is no matching
 * positive hint on the rail: the rail has no heading to put one in, and it
 * never advertised ←/→ either.
 */
export const useLidarStyleRingHint = () =>
  useAtomValue(bilderRingHasKeysAtom) ? '' : RING_HINT;

/**
 * Step the rail. Returns whether it was walked, so `useGroundMode` can fall
 * through to the ground's own style ring when there is no rail to walk.
 */
export const cycleBilderAtom = atom(
  null,
  (get, _set, step: 1 | -1): boolean => {
    // The same predicate the style heading reads, rather than the two tests
    // written out again here.
    if (!get(bilderRingHasKeysAtom)) return false;
    get(bilderRingAtom)?.step(step);
    return true;
  },
);
