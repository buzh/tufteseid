import { atom } from 'jotai';

// The left-hand card slot has one occupant at a time. `localities` is the
// list of them; the *open* lokalitet is deliberately not a MapTool, and
// neither are the LiDAR extract or the drawing surface — each is owned by
// its own state and takes the slot from the other side. See
// docs/ui-architecture.md §1.
export type MapTool = 'measure' | 'localities' | null;

export const mapToolAtom = atom<MapTool>(null);
