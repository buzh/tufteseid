// The kept render laid under an open draft: the picture the author is framing
// against, and the one the pen draws over. Published by the strip, because only
// the strip holds the rows, and read by `SpotSurface`, where the overlay and
// the sketch session live.

import { atom } from 'jotai';

export type DraftGround = {
  /** The row it came off, so the strip can drop it when that row goes. */
  id: string;
  url: string;
  /** EPSG:25833, as the render wrote it (`evidenceBbox`). */
  extent: [number, number, number, number];
};

export const draftGroundAtom = atom<DraftGround | null>(null);
