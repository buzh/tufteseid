// Which surface is in front, and one at a time. What each surface owes the
// swap is `docs/architecture.md`, *The context in front* — including why
// `Ribbon.module.css` states the band's height rather than leaving it to the
// contents.

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

/** Published by whichever draft controller has the pen (`useSpotDraft`), the
 *  only thing that can write the drawing: its box is away for the session but
 *  the controller under it is not, and the band drives it from here. */
export const drawHoldAtom = atom<DrawHold | null>(null);
