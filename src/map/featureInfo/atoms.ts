import { atom } from 'jotai';
import type { FeatureInfoReading } from './types';

export const heritageTipAtom = atom<FeatureInfoReading | null>(null);

export const heritagePopupAtom = atom<FeatureInfoReading | null>(null);
