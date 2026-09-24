import { atom } from 'jotai';

type DraftGround = {
  /** The row it came off, so the strip can drop it when that row goes. */
  id: string;
  url: string;
  /** EPSG:25833, as the render wrote it (`evidenceBbox`). */
  extent: [number, number, number, number];
};

export const draftGroundAtom = atom<DraftGround | null>(null);
