

import { atom } from 'jotai';
import { sketchSessionAtom } from '../sketch/session';

export type UiContext = 'map' | 'draw';

export const uiContextAtom = atom<UiContext>((get) =>
  get(sketchSessionAtom) ? 'draw' : 'map',
);

export type DrawHold = {
  name: string;

  save: () => void;

  abort: () => void;
};

export const drawHoldAtom = atom<DrawHold | null>(null);
