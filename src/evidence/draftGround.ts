import { atom } from 'jotai';

export type DraftGround = {

  id: string;
  url: string;

  extent: [number, number, number, number];

  loop?: { bandTop: number };
};

export const draftGroundAtom = atom<DraftGround | null>(null);
