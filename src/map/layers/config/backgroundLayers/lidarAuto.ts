// "Automatisk": the viewport chooses between the national mosaic (seamless 1 m),
// a per-acquisition project (0.25 m, with holes) and our own cached ground. It
// only decides, writing through the same selectNational / selectProject /
// selectCvat.

import { halved } from '../../../compare/halves';
import type { CvatAcquisition } from './cvatGround';
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

/** Which dataset is drawing, spelled out: a bare `LidarProject | null` cannot
 *  say "this acquisition, from the cache". */
export type LidarDataset =
  | { kind: 'national' }
  | { kind: 'project'; project: LidarProject }
  | { kind: 'cvat'; acquisition: CvatAcquisition };

export type LidarAutoChoice =
  | LidarDataset
  // Coverage still loading, or a hysteresis band: leave the dataset alone.
  | { kind: 'hold' };

export const chooseAutoDataset = ({
  resolution,
  viewport,
  current,
  cached,
}: {
  resolution: number | null;
  viewport: LidarViewportState;
  // What is drawing now. Not activeLidarProjectAtom: selecting the mosaic
  // leaves that holding the last project.
  current: LidarDataset;
  // What the cVAT store holds, as the manifest reported it. Empty on an
  // install without a store, and until it answers.
  cached: CvatAcquisition[];
}): LidarAutoChoice => {
  if (resolution == null) return { kind: 'hold' };
  if (resolution > AUTO_RELEASE_M_PER_PX) return { kind: 'national' };
  if (resolution > AUTO_ENGAGE_M_PER_PX) return { kind: 'hold' };

  // Too wide for the footprint WFS: fall back to the layer that always covers.
  if (viewport.status === 'zoomedOut') return { kind: 'national' };
  if (viewport.status !== 'ready') return { kind: 'hold' };

  const ratioOf = (id: string): number =>
    viewport.primary.find((e) => e.project.id === id)?.areaRatio ?? 0;

  // The best-covered cached acquisition on screen, ranked off the same viewport
  // list the projects are: "best" has to mean the same thing for both, or the
  // two halves of the comparison below are not comparable.
  const bestCached = cached.reduce<{
    acquisition: CvatAcquisition;
    ratio: number;
  } | null>((best, acquisition) => {
    const ratio = ratioOf(acquisition.project.id);
    return best && best.ratio >= ratio ? best : { acquisition, ratio };
  }, null);

  // The cache and the same acquisition's WMS are one ground, so hysteresis is
  // about the acquisition and not about which of the two is drawing it: a
  // project incumbent that *is* a cached acquisition moves to the cache once
  // and then holds there, rather than flapping between the two.
  const incumbentId =
    current.kind === 'cvat'
      ? current.acquisition.project.id
      : current.kind === 'project'
        ? current.project.id
        : null;
  const heldCached = cached.find((a) => a.project.id === incumbentId) ?? null;
  if (heldCached) {
    if (ratioOf(heldCached.project.id) >= AUTO_RELEASE_COVERAGE) {
      return { kind: 'cvat', acquisition: heldCached };
    }
  } else if (current.kind === 'project') {
    // Keep the incumbent while it still owns a fair share of the screen, or
    // panning along a seam reshuffles the ranking every few hundred metres.
    if (ratioOf(current.project.id) >= AUTO_RELEASE_COVERAGE) {
      return { kind: 'hold' };
    }
  }

  // Inside the footprint the cache wins outright, even against a newer or
  // denser acquisition that would rank above it: it is the better picture, it
  // is on our own disk, and it spares a rate-limited upstream.
  if (bestCached && bestCached.ratio >= AUTO_ENGAGE_COVERAGE) {
    return { kind: 'cvat', acquisition: bestCached.acquisition };
  }

  // The top of the list the pulldown would show; anything cleverer disagrees.
  const best = viewport.primary[0];
  if (best && best.areaRatio >= AUTO_ENGAGE_COVERAGE) {
    return { kind: 'project', project: best.project };
  }
  return { kind: 'national' };
};
