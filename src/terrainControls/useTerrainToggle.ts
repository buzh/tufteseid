// On frames a square to be placed and fetches nothing; the grid is read by
// `Start` in the box and released by `useTerrainControls`' fetch cleanup.

import { useAtomValue, useSetAtom } from 'jotai';
import {
  closeTerrainWindowAtom,
  openTerrainWindowAtom,
  terrainWindowAtom,
} from '../terrain/window';

export const useTerrainToggle = () => {
  const on = useAtomValue(terrainWindowAtom) !== null;
  const openWindow = useSetAtom(openTerrainWindowAtom);
  const closeWindow = useSetAtom(closeTerrainWindowAtom);

  return {
    on,
    toggle: () => (on ? closeWindow() : openWindow()),
  };
};

export type TerrainToggleControls = ReturnType<typeof useTerrainToggle>;
