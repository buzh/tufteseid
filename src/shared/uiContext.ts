// Which surface is in front, and one at a time. The map context is the app at
// rest: the band over the ground, boxes floating on it. A drawing takes the
// whole map rectangle, so every box stands down for it and the band carries
// the drawing's own controls instead of the map's.
//
// The band keeps its height across the swap. The scene↔ground mapping is bound
// at the freeze that opens a session (`sketch/session.ts`) and never rebound,
// so a band that grew or shrank afterwards would slide the map element out
// from under strokes already registered to it. `Ribbon.module.css` holds the
// height that makes both bands the same.

import { atom } from 'jotai';
import { sketchSessionAtom } from '../sketch/session';

export type UiContext = 'map' | 'draw';

export const uiContextAtom = atom<UiContext>((get) =>
  get(sketchSessionAtom) ? 'draw' : 'map',
);

/** What the draw context puts in the band: whose drawing it is and the two
 *  ways out of it. */
export type DrawHold = {
  name: string;
  /** Put the pen down and keep the strokes. */
  save: () => void;
  /** Put the pen down and go back to the stored drawing. */
  abort: () => void;
};

/**
 * Published by whichever draft controller has the pen (`useSpotDraft`), which
 * is the only thing that can write the drawing — its box is away for the
 * session but the controller under it is not, and the band drives it from
 * here.
 */
export const drawHoldAtom = atom<DrawHold | null>(null);
