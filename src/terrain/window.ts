import { atom } from 'jotai';
import type { LocalityBbox } from '../api/localities';
import { clampBboxSize } from '../localities/bboxLimits';
import { viewportBbox } from '../localities/createFromBbox';
import { mapAtom } from '../map/atoms';

/**
 * The rectangle Terreng is reading when no lokalitet is open — the visible map
 * framed at the moment the ground was entered, clamped into the same 50–1000 m
 * band a lokalitet lives in. Non-null is what makes `terreng` the ground on
 * screen for a reader with nothing open.
 *
 * Held rather than recomputed from the live view, and that is the whole cost
 * control: a DEM in the band is 64 MB and 16 Mpx of arithmetic per
 * visualization, so a render that followed the map would refetch all of it on
 * every pan. You pan and zoom underneath the analysis and move it deliberately,
 * with `Analyser her` on the settings strip.
 *
 * With a lokalitet open this stays null and `useTerrainAnalysis` reads the
 * lokalitet's own bbox instead, so there is only ever one rectangle in play.
 */
export const terrainWindowAtom = atom<LocalityBbox | null>(null);

/**
 * Frames the window on the visible map. False means the chrome is covering
 * everything there is to frame, which the caller reports — the same refusal
 * `Ny lokalitet` gives, for the same reason.
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
