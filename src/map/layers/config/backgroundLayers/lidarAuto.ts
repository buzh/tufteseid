// "Automatisk": the viewport chooses between the national mosaic (seamless 1 m)
// and a per-acquisition project (0.25 m, with holes). It only decides, writing
// through the same selectNational / selectProject.
//
// Flights only. Our cached VAT is a render of a flight, not a dataset beside
// one, so which of the two renders a chosen flight is drawn with is settled in
// the style tier by `resolveLidarStyle` — see `lidarProjects.ts`.

import { halved } from '../../../compare/halves';
import type { LidarProject } from './lidarProjects';
import type { LidarViewportState } from './lidarRelevance';

// Whether the dataset follows the viewport. Cleared by any explicit pick, and
// by entering compare on the B half (src/map/compare/atoms.ts).
export const lidarAutoDatasetHalves = halved(true);
export const lidarAutoDatasetAtom = lidarAutoDatasetHalves.focused;

// View resolution in metres per pixel (EPSG:25833, so ground metres). The
// mosaic is a 1 m grid, so below 1 m/px a project starts buying resolution.
export const AUTO_ENGAGE_M_PER_PX = 1;
// Hysteresis of one factor-2 zoom step: without a gap, nudging the zoom on the
// threshold swaps the whole stack, which is a screenful of WMS requests.
export const AUTO_RELEASE_M_PER_PX = 2;

// Screen fraction a project must paint to be given the background, and to keep
// it. Far above the picker's minAreaRatio (0.1): listing is a lower bar.
export const AUTO_ENGAGE_COVERAGE = 0.5;
export const AUTO_RELEASE_COVERAGE = 0.35;

export type LidarAutoChoice =
  | { kind: 'national' }
  | { kind: 'project'; project: LidarProject }
  // Coverage still loading, or a hysteresis band: leave the dataset alone.
  | { kind: 'hold' };

export const chooseAutoDataset = ({
  resolution,
  viewport,
  current,
}: {
  resolution: number | null;
  viewport: LidarViewportState;
  // The flight drawing now, or null for the mosaic. Not activeLidarProjectAtom:
  // selecting the mosaic leaves that holding the last one.
  current: LidarProject | null;
}): LidarAutoChoice => {
  if (resolution == null) return { kind: 'hold' };
  if (resolution > AUTO_RELEASE_M_PER_PX) return { kind: 'national' };
  if (resolution > AUTO_ENGAGE_M_PER_PX) return { kind: 'hold' };

  // Too wide for the footprint WFS: fall back to the layer that always covers.
  if (viewport.status === 'zoomedOut') return { kind: 'national' };
  if (viewport.status !== 'ready') return { kind: 'hold' };

  // Keep the incumbent while it still owns a fair share of the screen, or
  // panning along a seam reshuffles the ranking every few hundred metres.
  if (current) {
    const held = viewport.primary.find((e) => e.project.id === current.id);
    if (held && held.areaRatio >= AUTO_RELEASE_COVERAGE) {
      return { kind: 'hold' };
    }
  }

  // The top of the list the pulldown would show; anything cleverer disagrees.
  const best = viewport.primary[0];
  if (best && best.areaRatio >= AUTO_ENGAGE_COVERAGE) {
    return { kind: 'project', project: best.project };
  }
  return { kind: 'national' };
};
