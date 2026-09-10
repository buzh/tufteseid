import { atom } from 'jotai';
import type { LocalityBbox } from '../api/localities';

/**
 * The rectangle a *standalone* terrain analysis is running over — the visible
 * map, framed at the moment row 1's "Terreng" was pressed with no lokalitet
 * open. Non-null is what puts the terrain row on the ribbon.
 *
 * Held rather than recomputed from the current view: the analysis is of one
 * fixed rectangle, and the user is expected to pan and zoom underneath it
 * while reading the render. It is also the rectangle "Lagre" turns into a
 * lokalitet, which would otherwise quietly be somewhere else by then.
 *
 * With a lokalitet open this stays null and the workspace's `ribbonToolAtom`
 * drives the same panel over the lokalitet's own bbox instead.
 */
export const terrainStandaloneBboxAtom = atom<LocalityBbox | null>(null);
