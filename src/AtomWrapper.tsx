import { useHydrateAtoms } from 'jotai/utils';
import { ReactNode } from 'react';
import { activeThemeLayersAtom, readThemeLayers } from './map/layers/atoms.ts';

export const AtomWrapper = ({ children }: { children: ReactNode }) => {
  useHydrateAtoms([[activeThemeLayersAtom, readThemeLayers()]]);
  return children;
};
