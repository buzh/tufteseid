import { acrossHalves, halved } from '../../../compare/halves';
import { bboxOverlapRatio, type LidarProject } from './lidarProjects';
import type { LidarViewportState } from './lidarRelevance';

export const lidarAutoDatasetHalves = halved(true);

export const liveLidarAutoAtom = acrossHalves(lidarAutoDatasetHalves);

// View resolution in metres per pixel (EPSG:25833, so ground metres). The
// national mosaic is a 1 m grid; release is one factor-2 zoom step of
// hysteresis.
export const AUTO_ENGAGE_M_PER_PX = 1;
export const AUTO_RELEASE_M_PER_PX = 2;

// Screen fraction a project must paint to be given the background, and to keep
// it.
export const AUTO_ENGAGE_COVERAGE = 0.5;
export const AUTO_RELEASE_COVERAGE = 0.35;

// Overlap below which a pinned flight counts as left behind.
export const AUTO_RESUME_OVERLAP = 0.02;

// Both ratios, because either alone fires on a zoom rather than a pan.
// Envelopes, not footprints: a pinned half has no footprint list to consult.
export const pinnedFlightLeftBehind = (
  project: LidarProject | null,
  viewLonLat: [number, number, number, number] | null,
): boolean =>
  project != null &&
  viewLonLat != null &&
  bboxOverlapRatio(project.bboxLonLat, viewLonLat) < AUTO_RESUME_OVERLAP &&
  bboxOverlapRatio(viewLonLat, project.bboxLonLat) < AUTO_RESUME_OVERLAP;

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
  // The flight drawing now, or null for the mosaic. Not the half's own project
  // atom: selecting the mosaic leaves that holding the last one.
  current: LidarProject | null;
}): LidarAutoChoice => {
  if (resolution == null) return { kind: 'hold' };
  if (resolution > AUTO_RELEASE_M_PER_PX) return { kind: 'national' };
  if (resolution > AUTO_ENGAGE_M_PER_PX) return { kind: 'hold' };

  // Too wide for the footprint WFS: fall back to the layer that always covers.
  if (viewport.status === 'zoomedOut') return { kind: 'national' };

  // Breaker open: the list is what the cVAT store holds and the mosaic no
  // longer covers everywhere, so rank without the incumbent rule below.
  if (viewport.status === 'held') {
    const best = viewport.primary[0];
    return best && best.areaRatio >= AUTO_ENGAGE_COVERAGE
      ? { kind: 'project', project: best.project }
      : { kind: 'national' };
  }

  if (viewport.status !== 'ready') return { kind: 'hold' };

  // Keep the incumbent while it still owns a fair share of the screen;
  // otherwise panning along a seam reshuffles the ranking every few hundred
  // metres.
  if (current) {
    const held = viewport.primary.find((e) => e.project.id === current.id);
    if (held && held.areaRatio >= AUTO_RELEASE_COVERAGE) {
      return { kind: 'hold' };
    }
  }

  const best = viewport.primary[0];
  if (best && best.areaRatio >= AUTO_ENGAGE_COVERAGE) {
    return { kind: 'project', project: best.project };
  }
  return { kind: 'national' };
};
