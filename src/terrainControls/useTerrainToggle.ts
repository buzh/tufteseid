// The band's half of Terrenganalyse: on, off, and nothing else.
//
// Two atoms and no state, which is the point. The analysis itself is a DEM, a
// horizon scan and a canvas, and all of that lives with the box that floats
// over the map (`useTerrainControls`, mounted by `MapComponent`). The button in
// the band has no business holding any of it, and because starting and stopping
// are pure writes to `terrainWindowAtom`, it does not have to: the controller
// releases the grid in its own fetch cleanup when the rectangle goes away.
//
// The same split as Kulturminner, where the band's control and the card over
// the map are two surfaces over one subject that meet in the store.

import { useAtomValue, useSetAtom } from 'jotai';
import { frameTerrainWindowAtom, terrainWindowAtom } from '../terrain/window';

export const useTerrainToggle = () => {
  const on = useAtomValue(terrainWindowAtom) !== null;
  const setWindow = useSetAtom(terrainWindowAtom);
  const frameWindow = useSetAtom(frameTerrainWindowAtom);

  return {
    on,
    toggle: () => (on ? setWindow(null) : frameWindow()),
  };
};

export type TerrainToggleControls = ReturnType<typeof useTerrainToggle>;
