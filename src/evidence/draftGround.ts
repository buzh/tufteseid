import { atom } from 'jotai';

import type { OverlayTile } from './evidenceOverlay';

export type DraftGround = {
  /** The group (or row) it came off, so the list can drop it when that goes. */
  id: string;
  /** The still tiles to lay — a mosaic's whole grid, or one box. Empty when
   *  `loop` is set. */
  tiles: OverlayTile[];
  /** A WebM loop rather than stills — always one tile — carrying where its
   *  burnt-in band starts (`evidenceBandTop`). The two go to different
   *  overlays. */
  loop?: {
    url: string;
    extent: [number, number, number, number];
    bandTop: number;
  };
};

/** EPSG:25833 bounds over whatever the ground lays, for the sketch session's
 *  frame fit. Null for a ground carrying nothing. */
export const draftGroundExtent = (
  ground: DraftGround,
): [number, number, number, number] | null => {
  const boxes = ground.loop
    ? [ground.loop.extent]
    : ground.tiles.map((tile) => tile.extent);
  if (boxes.length === 0) return null;
  return boxes.reduce((acc, e) => [
    Math.min(acc[0], e[0]),
    Math.min(acc[1], e[1]),
    Math.max(acc[2], e[2]),
    Math.max(acc[3], e[3]),
  ]);
};

// A picture laid on the map at the extent it was rendered over, to trace a
// drawing onto. Set/cleared by `EvidenceGallery` (a kept picture) and
// `useFlyfotoRun` (a proposal), drawn by `SpotSurface`'s overlays; only one is
// ever mounted.
export const draftGroundAtom = atom<DraftGround | null>(null);
