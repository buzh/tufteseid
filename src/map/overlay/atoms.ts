import { atom } from 'jotai';

// The left-hand card slot has one occupant at a time. Drawing, LiDAR
// extract and the lokalitet workspace are deliberately NOT MapTools — they
// are owned by their own state and take the slot from the other side. See
// docs/ui-architecture.md §1.
export type MapTool = 'measure' | 'localities' | null;

export const mapToolAtom = atom<MapTool>(null);
