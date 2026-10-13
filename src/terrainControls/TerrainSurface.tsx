

import { useAtomValue } from 'jotai';

import { uiContextAtom } from '../shared/uiContext';
import { TerrainPanel } from './TerrainPanel';
import { useTerrainControls } from './useTerrainControls';

export const TerrainSurface = () => {
  const context = useAtomValue(uiContextAtom);
  const terrain = useTerrainControls();

  return terrain.on && context === 'map' ? (
    <TerrainPanel terrain={terrain} />
  ) : null;
};
