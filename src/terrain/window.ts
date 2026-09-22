import { atom } from 'jotai';
import { mapAtom } from '../map/atoms';
import { squareBboxWithin, viewportBbox, type Bbox } from '../map/bbox';

/**
 * The rectangle terrain analysis is reading: the visible map framed at the
 * moment the reader asked for it, as the largest square that fits inside it and
 * at most `MAX_SIDE_M` on a side. Null is the analysis being off — nothing else
 * records that, and the frame on the map and the render both hang off this.
 *
 * Held rather than recomputed from the live view, and that is the whole cost
 * control: a DEM at the ceiling is 19 MB and 4.8 Mpx of arithmetic per
 * visualization, so a render that followed the map would refetch all of it on
 * every pan. The reader pans and zooms underneath the analysis and moves it
 * deliberately, with `Analyser her`.
 */
export const terrainWindowAtom = atom<Bbox | null>(null);

/**
 * Frames the window on the visible map. False means there was nothing to
 * frame — the map has no size yet, i.e. before first layout — which is not a
 * state a reader can be in and which the caller therefore passes over in
 * silence.
 *
 * Zoomed out to the county you get a `MAX_SIDE_M` square in the middle of the
 * screen, which the frame on the map then shows you; zoomed in past that, the
 * square is what the screen holds, so its four edges are always on it.
 */
export const frameTerrainWindowAtom = atom(null, (get, set): boolean => {
  const seed = viewportBbox(get(mapAtom));
  if (!seed) return false;
  set(terrainWindowAtom, squareBboxWithin(seed));
  return true;
});
