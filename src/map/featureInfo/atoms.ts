import { atom } from 'jotai';
import type { FeatureInfoResult } from './types';

// What the last GetFeatureInfo came back with. `layers/atoms.ts` prunes it when
// a theme layer is switched off, so a reading never outlives the layer it came
// from.
export const featureInfoResultAtom = atom<FeatureInfoResult | null>(null);

export const featureInfoPanelOpenAtom = atom<boolean>(false);
