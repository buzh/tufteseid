// Terrenganalyse's half of the map: the controller, and the box when there is
// one. `MapComponent` mounts this and passes it nothing.
//
// A component of its own rather than a hook call in the host, because the
// controller is where every setting in the box lives and an azimuth drag writes
// one of them per frame. Held here, that churn re-renders the box; held in
// `MapComponent`, it would re-render the panes, the curtain and the heritage
// card alongside it, none of which have anything to do with the sun.
//
// The controller is mounted whether or not there is an analysis: the reading —
// visualization, sun, exaggeration, radii, transparency — has to survive taking
// a render down to look at the ground under it, and the box is what comes and
// goes.

import { TerrainPanel } from './TerrainPanel';
import { useTerrainControls } from './useTerrainControls';

export const TerrainSurface = () => {
  const terrain = useTerrainControls();

  return terrain.on ? <TerrainPanel terrain={terrain} /> : null;
};
