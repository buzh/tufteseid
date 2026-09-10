import { atom, type Getter, type Setter } from 'jotai';

/*
 * A and B — the two halves of the compare curtain, and which one the ribbon's
 * controls are currently pointed at.
 *
 * The first version of Sammenlign gave the B half a ground and nothing else:
 * the dataset pulldowns wrote one set of atoms, both stacks read them, so
 * "the 1937 flight against the 2024 flight" — the comparison the mode exists
 * for — could not be expressed at all. The obvious fix is a second set of
 * pickers for B, and it is the wrong one: two of every control on a bar whose
 * governing rule is *bodies, not rows*, and each pair free to drift out of
 * agreement about what it is even naming.
 *
 * So instead every piece of ground state is **two primitives and a facade**.
 * The facade keeps the name the rest of the app already imports and routes
 * each read and write to whichever half has focus. The result is that
 * useLidarControls, useFlyfotoControls, the pickers, the style clamping and
 * the W/S rings did not have to change at all: point the focus at B and the
 * same controls describe B. What has to know about halves is exactly the two
 * layer effects (each pinned to its own side), the figure captions (which
 * report the whole map, so both), and the A|B switch itself.
 *
 * This module deliberately imports nothing but jotai. Half the background
 * config imports it, so anything else in here would be a cycle.
 */

export type CompareHalf = 'a' | 'b';

/** Whether the curtain is up. Not persisted: see compareLayerAtomEffect. */
export const compareOnAtom = atom(false);

/**
 * Which half the ribbon is adjusting. Only meaningful while the curtain is
 * up, which is what `focusedHalfAtom` below enforces — leaving compare resets
 * it anyway, but a stale 'b' between those two writes would send a control's
 * value into a half nothing is drawing.
 */
export const compareFocusAtom = atom<CompareHalf>('a');

export const focusedHalfAtom = atom<CompareHalf>((get) =>
  get(compareOnAtom) ? get(compareFocusAtom) : 'a',
);

type Update<T> = T | ((prev: T) => T);

const SEEDERS: ((get: Getter, set: Setter) => void)[] = [];

/**
 * One piece of ground state, twice, behind a focused facade.
 *
 * Both halves start on the same value; B is re-seeded from A on the way into
 * compare (`seedHalfB`), so the right half opens showing what the left half
 * shows and every subsequent divergence is something the user asked for.
 */
export const halved = <T>(initial: T) => {
  const a = atom(initial);
  const b = atom(initial);
  SEEDERS.push((get, set) => set(b, get(a)));
  const focused = atom(
    (get) => get(get(focusedHalfAtom) === 'b' ? b : a),
    (get, set, update: Update<T>) =>
      set(get(focusedHalfAtom) === 'b' ? b : a, update),
  );
  return { a, b, focused };
};

/**
 * Copy every pair's A value into its B value.
 *
 * A registry rather than a hand-written list of assignments in the compare
 * module: a pair added later and forgotten here would open the curtain on
 * whatever that atom happened to be initialised with, which for an
 * acquisition is `null` and renders nothing.
 */
export const seedHalfB = (get: Getter, set: Setter): void => {
  for (const seed of SEEDERS) seed(get, set);
};
