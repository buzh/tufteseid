import { atom } from 'jotai';

import type { OverlayTile } from './evidenceOverlay';

export type DraftGround = {
  id: string;
  tiles: OverlayTile[];
  loop?: {
    url: string;
    extent: [number, number, number, number];
    bandTop: number;
  };
};

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

export const draftGroundAtom = atom<DraftGround | null>(null);
