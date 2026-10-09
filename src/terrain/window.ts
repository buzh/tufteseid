import { atom } from 'jotai';
import { mapAtom } from '../map/atoms';
import {
  bboxEquals,
  bboxOverlaps,
  bringBboxIntoView,
  squareBboxWithin,
  viewportBbox,
  type Bbox,
} from '../map/bbox';

/** The rectangle terrain analysis is reading, or about to. Null is the
 *  analysis being off — nothing else records that. Held rather than recomputed
 *  from the live view, so the render does not follow the map. */
export const terrainWindowAtom = atom<Bbox | null>(null);

/** The rectangle is being placed, so nothing is fetched for it yet. The drag
 *  writes `terrainWindowAtom` every frame, so the fetch waits on this rather
 *  than on the rectangle existing. */
export const terrainAdjustingAtom = atom(false);

/** Frame a square on what is visible and hand it to the reader to place. False
 *  means the map has no size yet, i.e. before first layout. */
export const openTerrainWindowAtom = atom(null, (get, set): boolean => {
  const seed = viewportBbox(get(mapAtom));
  if (!seed) return false;
  set(terrainWindowAtom, squareBboxWithin(seed));
  set(terrainAdjustingAtom, true);
  return true;
});

/** Read a rectangle settled elsewhere — a spot's footprint — so the reading
 *  starts at once with nothing to place. Left alone if it is already the
 *  rectangle being read, whose grid would otherwise be fetched twice. */
export const readTerrainWindowAtom = atom(null, (get, set, bbox: Bbox) => {
  const current = get(terrainWindowAtom);
  if (!current || !bboxEquals(current, bbox)) set(terrainWindowAtom, bbox);
  set(terrainAdjustingAtom, false);
  bringBboxIntoView(get(mapAtom), bbox);
});

/** Take hold of the rectangle again; reframed only if it is off screen. */
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
