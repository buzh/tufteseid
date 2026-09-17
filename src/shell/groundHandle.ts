import { atom } from 'jotai';
import type { CompareHalf } from '../map/compare/halves';
import type { GroundMode } from './useGroundMode';

/**
 * The slice of `useGroundMode` the lokalitet row needs, published across the
 * sibling gap: `useGroundMode` is mounted once in `RibbonGlobalRow` (a second
 * mount means a second DEM) and the two ribbon rows have no parent between
 * them to hand it down from.
 *
 * `previous` and `select` must be stable delegates over a ref, not the
 * closures `useGroundMode` rebuilds each render, or every keystroke in row 1's
 * search field re-renders the lokalitet row.
 */
export type GroundHandle = {
  /** Which of the five grounds is on screen, for the button's `active`. */
  mode: GroundMode;
  /** Which half of the compare curtain the ribbon is pointed at. */
  half: CompareHalf;
  /** The mode before this one — what Sammenlign opens against. */
  previous: () => GroundMode | null;
  select: (next: GroundMode) => void;
};

export const groundHandleAtom = atom<GroundHandle | null>(null);
