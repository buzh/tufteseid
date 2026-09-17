import { useHydrateAtoms } from 'jotai/utils';
import { ReactNode } from 'react';
import { activeThemeLayersAtom } from './map/layers/atoms.ts';
import { ThemeLayerName } from './map/layers/themeWMS.ts';
import { getListUrlParameter } from './shared/utils/urlUtils.ts';

// backgroundLayerAtom is deliberately absent: its own default init already
// validates the URL param against a whitelist, and hydrating again here
// bypasses that, leaving an unrenderable value and a blank map on cold load.
export const AtomWrapper = ({ children }: { children: ReactNode }) => {
  const initialThemeLayersList = getListUrlParameter('themeLayers') || [];
  const initialThemeLayers = new Set(
    initialThemeLayersList as ThemeLayerName[],
  );

  useHydrateAtoms([[activeThemeLayersAtom, initialThemeLayers]]);
  return children;
};
