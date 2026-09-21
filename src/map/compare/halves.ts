import { atom, type Getter, type Setter } from 'jotai';

// The two halves of the compare curtain, and which one the controls point
// at: every piece of ground state is two primitives behind a facade routing to
// the focused half, so the existing controls describe B unchanged. Imports
// nothing but jotai — half the background config imports this, so anything else
// would be a cycle.

export type CompareHalf = 'a' | 'b';

/** Whether the curtain is up. Not persisted: see compareLayerAtomEffect. */
export const compareOnAtom = atom(false);

/** Which half the ribbon is adjusting. Read through `focusedHalfAtom`, which
 * forces 'a' while the curtain is down. */
export const compareFocusAtom = atom<CompareHalf>('a');

export const focusedHalfAtom = atom<CompareHalf>((get) =>
  get(compareOnAtom) ? get(compareFocusAtom) : 'a',
);

type Update<T> = T | ((prev: T) => T);

const SEEDERS: ((get: Getter, set: Setter) => void)[] = [];

/** One piece of ground state, twice, behind a focused facade. */
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
 * Copy every pair's A value into its B value, so the curtain opens on two
 * identical halves. A registry rather than a list, because a pair added later
 * and forgotten would open B on its initial value — `null` for an acquisition,
 * which renders nothing.
 */
export const seedHalfB = (get: Getter, set: Setter): void => {
  for (const seed of SEEDERS) seed(get, set);
};
