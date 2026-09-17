import { atom } from 'jotai';

// The left-hand card slot has one occupant at a time. `localities` is the list
// of them; the open lokalitet, the LiDAR extract and the drawing surface are
// not MapTools — each takes the slot from the other side.
export type MapTool = 'measure' | 'localities' | null;

export const mapToolAtom = atom<MapTool>(null);
