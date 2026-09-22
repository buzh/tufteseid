// The band's half of Terrenganalyse: on, off, and nothing else.
//
// Two write atoms and no state, which is the point. The analysis itself is a
// DEM, a horizon scan and a canvas, and all of that lives with the box that
// floats over the map (`useTerrainControls`, mounted by `MapComponent`). The
// button in the band has no business holding any of it, and because starting
// and stopping are pure atom writes, it does not have to: the controller
// releases the grid in its own fetch cleanup when the rectangle goes away.
//
// On frames a square and hands it over to be placed; it fetches nothing. What
// the button costs is therefore a rectangle on the screen, and what it can
// never do is spend a reader's bandwidth on the ground they happened to be
// looking at.
//
// The same split as Kulturminner, where the band's control and the card over
// the map are two surfaces over one subject that meet in the store.

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
