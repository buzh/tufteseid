import { useHydrateAtoms } from 'jotai/utils';
import { ReactNode } from 'react';
import { activeThemeLayersAtom, readThemeLayers } from './map/layers/atoms.ts';

// Do not hydrate `backgroundLayerHalves` here: its own default init validates
// the URL param against a whitelist, and hydrating bypasses that, leaving an
// unrenderable value and a blank map on cold load.
export const AtomWrapper = ({ children }: { children: ReactNode }) => {
  useHydrateAtoms([[activeThemeLayersAtom, readThemeLayers()]]);
  return children;
};
