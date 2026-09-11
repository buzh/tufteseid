import { atom } from 'jotai';
import type { CompareHalf } from '../map/compare/halves';
import type { GroundMode } from './useGroundMode';

/**
 * The slice of `useGroundMode` the *lokalitet row* needs, published across the
 * sibling gap (docs/lokalitet-view.md §8).
 *
 * Terreng and Sammenlign moved onto that row, but the machinery behind them
 * did not: the four control hooks and `useGroundMode` are mounted once, in
 * `RibbonGlobalRow`, because the settings strip and the slider row run off the
 * same objects and a second copy would mean a second DEM. The two rows are
 * siblings under `Ribbon`, each in its own error boundary, so there is no
 * parent to hand them down from — the same gap `beholdOfferAtom` and
 * `coverTerrainSpecAtom` already cross, in the same direction.
 *
 * Four members, no more. Two facts the buttons render from and two questions
 * they ask on click; `cycle` and the peek stay behind, because the keyboard is
 * registered once and row 1 is where it is registered.
 *
 * `previous` and `select` are stable delegates over a ref rather than the
 * closures `useGroundMode` rebuilds each render — so the atom changes only
 * when `mode` or `half` does, and the lokalitet row is not re-rendered by
 * every keystroke in row 1's search field.
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
