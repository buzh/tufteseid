// The controller is mounted whether or not there is an analysis: the reading —
// visualization, sun, exaggeration, radii, transparency — is its own state and
// has to survive taking the render down.

import { TerrainPanel } from './TerrainPanel';
import { useTerrainControls } from './useTerrainControls';

export const TerrainSurface = () => {
  const terrain = useTerrainControls();

  return terrain.on ? <TerrainPanel terrain={terrain} /> : null;
};
