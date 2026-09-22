import { atom, type Getter, type PrimitiveAtom, type Setter } from 'jotai';

// How many grounds are on the screen, and the two halves of the state that
// describes them. Every piece of ground state is two primitives: `a` is the
// left of the screen — and the whole of it while one ground is up — and `b` the
// right. A surface says which half it is driving; there is no notion of focus,
// because the band carries a ground section per half.
//
// Imports nothing but jotai: half the background config imports this, so
// anything else would be a cycle.

export type CompareHalf = 'a' | 'b';

const BOTH_HALVES = ['a', 'b'] as const;

/**
 * How the map is being looked at, in the order the view control offers them:
 *
 * | `single`  | one ground over the whole map |
 * | `curtain` | two grounds in one viewport, B clipped right of a draggable edge |
 * | `split`   | two viewports side by side on one view, so each half is centred on the same point |
 *
 * Not persisted to the URL, because two live tile stacks are roughly twice the
 * GetMap requests against a shared rate limit: a shared link opens on one
 * ground and the reader asks for the second.
 */
export const VIEW_MODES = ['single', 'curtain', 'split'] as const;

/** The list above, as the type. Derived rather than spelled out twice: a fourth
 *  mode written into only one of them would render no button and typecheck. */
export type ViewMode = (typeof VIEW_MODES)[number];

export const viewModeAtom = atom<ViewMode>('single');

/** Whether the B half is drawing at all — true in both two-ground views. */
export const compareOnAtom = atom((get) => get(viewModeAtom) !== 'single');

/**
 * The halves that are drawing, in screen order. Every array produced by
 * `acrossHalves` is indexed the same way, so a caller can zip two of them.
 */
const liveHalvesAtom = atom<readonly CompareHalf[]>((get) =>
  get(compareOnAtom) ? BOTH_HALVES : ['a'],
);

export type Halved<T> = {
  a: PrimitiveAtom<T>;
  b: PrimitiveAtom<T>;
};

const SEEDERS: ((get: Getter, set: Setter) => void)[] = [];

/** One piece of ground state, once per half. */
export const halved = <T>(initial: T): Halved<T> => {
  const a = atom(initial);
  const b = atom(initial);
  SEEDERS.push((get, set) => set(b, get(a)));
  return { a, b };
};

/**
 * One pair read across every half that is drawing: one value while a single
 * ground is up, two while both are, in `liveHalvesAtom` order.
 *
 * What a surface belonging to the map rather than to a half reads. The
 * footprint layer draws for whichever halves are on LiDAR, and the tile guard
 * refreshes whatever is on either — neither has a half of its own to point at.
 */
export const acrossHalves = <T>(pair: Halved<T>) =>
  atom<T[]>((get) => get(liveHalvesAtom).map((half) => get(pair[half])));

/**
 * Copy every pair's A value into its B value, so a two-ground view opens on two
 * identical halves and the one thing the reader then changes is the comparison.
 * A registry rather than a list, because a pair added later and forgotten would
 * open B on its initial value — `null` for an acquisition, which renders
 * nothing.
 */
export const seedHalfB = (get: Getter, set: Setter): void => {
  for (const seed of SEEDERS) seed(get, set);
};
