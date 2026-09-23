import { atom, type Getter, type PrimitiveAtom, type Setter } from 'jotai';

// `a` is the left of the screen, and the whole of it while one ground is up;
// `b` is the right. Must import nothing but jotai — half the background config
// imports this, so anything else is a cycle.

export type CompareHalf = 'a' | 'b';

const BOTH_HALVES = ['a', 'b'] as const;

/** In the order the view control offers them. Not persisted to the URL. */
export const VIEW_MODES = ['single', 'curtain', 'split'] as const;

export type ViewMode = (typeof VIEW_MODES)[number];

export const viewModeAtom = atom<ViewMode>('single');

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

export const halved = <T>(initial: T): Halved<T> => {
  const a = atom(initial);
  const b = atom(initial);
  SEEDERS.push((get, set) => set(b, get(a)));
  return { a, b };
};

/**
 * One pair read across every half that is drawing: one value while a single
 * ground is up, two while both are, in `liveHalvesAtom` order.
 */
export const acrossHalves = <T>(pair: Halved<T>) =>
  atom<T[]>((get) => get(liveHalvesAtom).map((half) => get(pair[half])));

/**
 * Copy every pair's A value into its B value, so a two-ground view opens on two
 * identical halves. Registered by `halved`, so a new pair cannot be forgotten.
 */
export const seedHalfB = (get: Getter, set: Setter): void => {
  for (const seed of SEEDERS) seed(get, set);
};
