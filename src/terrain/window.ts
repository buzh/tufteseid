import { atom } from 'jotai';
import { mapAtom } from '../map/atoms';
import { clampBboxSize, viewportBbox, type Bbox } from '../map/bbox';

/**
 * The rectangle terrain analysis is reading: the visible map framed at the
 * moment the reader asked for it, clamped into the 50–1000 m band of
 * `src/map/bbox.ts`.
 *
 * Held rather than recomputed from the live view, and that is the whole cost
 * control: a DEM in the band is 64 MB and 16 Mpx of arithmetic per
 * visualization, so a render that followed the map would refetch all of it on
 * every pan. The reader pans and zooms underneath the analysis and moves it
 * deliberately.
 */
export const terrainWindowAtom = atom<Bbox | null>(null);

/**
 * Frames the window on the visible map. False means there was nothing to
 * frame, which the caller reports.
 *
 * Clamped about the centre rather than refused when the view is wider than the
 * band: zoomed out to the county you get a 1000 m square in the middle of the
 * screen, which the frame on the map then shows you.
 */
export const frameTerrainWindowAtom = atom(null, (get, set): boolean => {
  const seed = viewportBbox(get(mapAtom));
  if (!seed) return false;
  set(terrainWindowAtom, clampBboxSize(seed, 'centre'));
  return true;
});
