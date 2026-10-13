import { acrossHalves, halved } from '../../../compare/halves';
import { bboxOverlapRatio, type LidarProject } from './lidarProjects';
import type { LidarViewportState } from './lidarRelevance';

export const lidarAutoDatasetHalves = halved(true);

export const liveLidarAutoAtom = acrossHalves(lidarAutoDatasetHalves);

export const AUTO_ENGAGE_M_PER_PX = 1;
export const AUTO_RELEASE_M_PER_PX = 2;

export const AUTO_ENGAGE_COVERAGE = 0.5;
export const AUTO_RELEASE_COVERAGE = 0.35;

export const AUTO_RESUME_OVERLAP = 0.02;

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

  | { kind: 'hold' };

export const chooseAutoDataset = ({
  resolution,
  viewport,
  current,
}: {
  resolution: number | null;
  viewport: LidarViewportState;

  current: LidarProject | null;
}): LidarAutoChoice => {
  if (resolution == null) return { kind: 'hold' };
  if (resolution > AUTO_RELEASE_M_PER_PX) return { kind: 'national' };
  if (resolution > AUTO_ENGAGE_M_PER_PX) return { kind: 'hold' };

  if (viewport.status === 'zoomedOut') return { kind: 'national' };

  if (viewport.status === 'held') {
    const best = viewport.primary[0];
    return best && best.areaRatio >= AUTO_ENGAGE_COVERAGE
      ? { kind: 'project', project: best.project }
      : { kind: 'national' };
  }

  if (viewport.status !== 'ready') return { kind: 'hold' };

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
