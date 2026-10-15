import { atom, type Getter, type PrimitiveAtom, type Setter } from 'jotai';

export type CompareHalf = 'a' | 'b';

const BOTH_HALVES = ['a', 'b'] as const;

export const VIEW_MODES = ['single', 'curtain', 'blend', 'split'] as const;

export type ViewMode = (typeof VIEW_MODES)[number];

export const viewModeAtom = atom<ViewMode>('single');

export const compareOnAtom = atom((get) => get(viewModeAtom) !== 'single');

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

export const acrossHalves = <T>(pair: Halved<T>) =>
  atom<T[]>((get) => get(liveHalvesAtom).map((half) => get(pair[half])));

export const seedHalfB = (get: Getter, set: Setter): void => {
  for (const seed of SEEDERS) seed(get, set);
};
