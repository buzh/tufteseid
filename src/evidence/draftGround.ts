import { atom } from 'jotai';

export type DraftGround = {
  /** The row it came off, so the list can drop it when that row goes. */
  id: string;
  url: string;
  /** EPSG:25833, as the render wrote it (`evidenceBbox`). */
  extent: [number, number, number, number];
  /** A WebM loop rather than a still, carrying where its burnt-in band starts
   *  (`evidenceBandTop`). The two go to different overlays. */
  loop?: { bandTop: number };
};

/** A picture laid on the map at the extent it was rendered over, to trace a
 *  drawing onto or to read the spot's own drawing against. Set and cleared by
 *  `EvidenceGallery` for a kept row and by `useFlyfotoRun` for a proposal;
 *  drawn by `SpotSurface`'s evidence overlays. Only one of the two is ever
 *  mounted. */
export const draftGroundAtom = atom<DraftGround | null>(null);
