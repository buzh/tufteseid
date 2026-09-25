import { atom } from 'jotai';

type DraftGround = {
  /** The row it came off, so the list can drop it when that row goes. */
  id: string;
  url: string;
  /** EPSG:25833, as the render wrote it (`evidenceBbox`). */
  extent: [number, number, number, number];
};

/** One of the spot's own pictures laid back on the map at the extent it was
 *  rendered over, to trace a drawing onto. Set and cleared by
 *  `EvidenceGallery`, drawn by `SpotSurface`'s evidence overlay. */
export const draftGroundAtom = atom<DraftGround | null>(null);
