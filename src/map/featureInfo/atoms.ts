import { atom } from 'jotai';
import type { FeatureInfoReading } from './types';

// The hover reading and the clicked one: the tip goes with the pointer, the
// card stays until it is dismissed. `layers/atoms.ts` prunes both when a
// register is switched off.

export const heritageTipAtom = atom<FeatureInfoReading | null>(null);

export const heritagePopupAtom = atom<FeatureInfoReading | null>(null);
