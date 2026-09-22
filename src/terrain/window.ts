import { atom } from 'jotai';
import { mapAtom } from '../map/atoms';
import {
  bboxOverlaps,
  squareBboxWithin,
  viewportBbox,
  type Bbox,
} from '../map/bbox';

/**
 * The rectangle terrain analysis is reading, or about to: a square framed on
 * the visible map and then placed by hand, at most `MAX_SIDE_M` on a side. Null
 * is the analysis being off — nothing else records that, and the frame on the
 * map and the render both hang off this.
 *
 * Held rather than recomputed from the live view, and that is the whole cost
 * control: a DEM at the ceiling is 19 MB and 4.8 Mpx of arithmetic per
 * visualization, so a render that followed the map would refetch all of it on
 * every pan. The reader pans and zooms underneath the analysis and moves it
 * deliberately, with `Juster`.
 */
export const terrainWindowAtom = atom<Bbox | null>(null);

/**
 * The rectangle is being placed, so nothing is fetched for it yet.
 *
 * Every state the analysis can be in is these two atoms: no rectangle is off,
 * a rectangle being placed is the reader choosing the ground, and a rectangle
 * standing still is the analysis itself. The drag writes `terrainWindowAtom`
 * as the hand moves, which is why the fetch has to be told to wait rather than
 * being started by the rectangle existing — sixty rectangles a second is sixty
 * height grids.
 */
export const terrainAdjustingAtom = atom(false);

/**
 * Turn the analysis on: frame a square on what is visible and hand it to the
 * reader to place. False means there was nothing to frame — the map has no size
 * yet, i.e. before first layout — which is not a state a reader can be in and
 * which the caller therefore passes over in silence.
 *
 * Zoomed out to the county you get a `MAX_SIDE_M` square in the middle of the
 * screen; zoomed in past that, the square is what the screen holds, so its four
 * edges are always on it and there is always something to take hold of.
 */
export const openTerrainWindowAtom = atom(null, (get, set): boolean => {
  const seed = viewportBbox(get(mapAtom));
  if (!seed) return false;
  set(terrainWindowAtom, squareBboxWithin(seed));
  set(terrainAdjustingAtom, true);
  return true;
});

/**
 * Take hold of the rectangle again, from `Juster`.
 *
 * It is reframed only when it has gone off the screen entirely. The analysis
 * does not follow the map, so a reader who has panned a valley away and then
 * asks to adjust is asking about the ground in front of them; one who can still
 * see a corner of it means that rectangle, and moving it out from under them
 * would be the control answering a different question.
 */
export const adjustTerrainWindowAtom = atom(null, (get, set) => {
  const current = get(terrainWindowAtom);
  const seed = viewportBbox(get(mapAtom));
  if (seed && (!current || !bboxOverlaps(current, seed))) {
    set(terrainWindowAtom, squareBboxWithin(seed));
  }
  set(terrainAdjustingAtom, true);
});

/** Turn it off. Both atoms, so the next press starts from a clean frame. */
export const closeTerrainWindowAtom = atom(null, (_get, set) => {
  set(terrainWindowAtom, null);
  set(terrainAdjustingAtom, false);
});
