import { atom } from 'jotai';
import { mapAtom } from '../map/atoms';
import {
  bboxEquals,
  bboxOverlaps,
  bboxWidthMetres,
  bringBboxIntoView,
  MAX_SIDE_M,
  squareBboxWithin,
  viewportBbox,
  type Bbox,
} from '../map/bbox';

export const terrainWindowAtom = atom<Bbox | null>(null);

export const terrainAdjustingAtom = atom(false);

export const openTerrainWindowAtom = atom(null, (get, set): boolean => {
  const seed = viewportBbox(get(mapAtom));
  if (!seed) return false;
  set(terrainWindowAtom, squareBboxWithin(seed));
  set(terrainAdjustingAtom, true);
  return true;
});

export const readTerrainWindowAtom = atom(null, (get, set, bbox: Bbox) => {
  const window =
    bboxWidthMetres(bbox) > MAX_SIDE_M ? squareBboxWithin(bbox) : bbox;
  const current = get(terrainWindowAtom);
  if (!current || !bboxEquals(current, window)) set(terrainWindowAtom, window);
  set(terrainAdjustingAtom, false);
  bringBboxIntoView(get(mapAtom), window);
});

export const adjustTerrainWindowAtom = atom(null, (get, set) => {
  const current = get(terrainWindowAtom);
  const seed = viewportBbox(get(mapAtom));
  if (seed && (!current || !bboxOverlaps(current, seed))) {
    set(terrainWindowAtom, squareBboxWithin(seed));
  }
  set(terrainAdjustingAtom, true);
});

export const closeTerrainWindowAtom = atom(null, (_get, set) => {
  set(terrainWindowAtom, null);
  set(terrainAdjustingAtom, false);
});
