// The controller is mounted whether or not there is an analysis: the reading is
// its own state and has to survive taking the render down.

import { useAtomValue } from 'jotai';

import { uiContextAtom } from '../shared/uiContext';
import { TerrainPanel } from './TerrainPanel';
import { useTerrainControls } from './useTerrainControls';

export const TerrainSurface = () => {
  const context = useAtomValue(uiContextAtom);
  const terrain = useTerrainControls();

  // Only the box stands down for a drawing. The render stays on the map, which
  // is the whole point of drawing over one.
  return terrain.on && context === 'map' ? (
    <TerrainPanel terrain={terrain} />
  ) : null;
};
