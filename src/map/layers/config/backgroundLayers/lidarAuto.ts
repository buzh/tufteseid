// "Automatisk": the viewport chooses between the national mosaic (seamless 1 m)
// and a per-acquisition project (0.25 m, with holes). It only decides, writing
// through the same selectNational / selectProject.
//
// Flights only. Our cached VAT is a render of a flight, not a dataset beside
// one, so which of the two renders a chosen flight is drawn with is settled in
// the style tier by `resolveLidarStyle` — see `lidarProjects.ts`.

import { acrossHalves, halved } from '../../../compare/halves';
import { bboxOverlapRatio, type LidarProject } from './lidarProjects';
import type { LidarViewportState } from './lidarRelevance';

// Whether the dataset follows the viewport. Cleared by the toggle beside the
// ribbon's chips, by any pick out of either chip — the render counts, because a
// dataset switch re-derives it — and by entering compare on the B half
// (src/map/compare/atoms.ts). Set again by the toggle, and by panning clear of
// a pinned flight (`pinnedFlightLeftBehind`, below).
export const lidarAutoDatasetHalves = halved(true);

/** Automatisk, per half that is drawing. The footprint layer keeps the viewport
 *  list warm for whichever halves are asking for it. */
export const liveLidarAutoAtom = acrossHalves(lidarAutoDatasetHalves);

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

// A pin is only a pin over the flight it names. Panning clear of that flight
// leaves the reader on blank ground with no way back but a toggle they have to
// remember was ever pressed, so at that point Automatisk takes the dataset
// back. Nothing else clears a pin: it survives every pan that still has the
// flight on screen, and every zoom.
export const AUTO_RESUME_OVERLAP = 0.02;

/**
 * Whether a pinned flight has been left behind — neither on screen in any
 * quantity nor holding the screen. Both fractions, because either one alone
 * fires on a zoom rather than a pan: filling the screen is how a flight reads
 * zoomed in, and being wholly inside it is how the same flight reads zoomed
 * out. Both fall to zero only when the viewport has moved off the flight.
 *
 * Envelopes, not footprints: a pinned half has the pulldown closed and no
 * footprint list to consult, and an envelope contains its footprint, so leaving
 * the envelope is leaving the flight for certain.
 */
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
  // The flight drawing now, or null for the mosaic. Not the half's own
  // project atom: selecting the mosaic leaves that holding the last one.
  current: LidarProject | null;
}): LidarAutoChoice => {
  if (resolution == null) return { kind: 'hold' };
  if (resolution > AUTO_RELEASE_M_PER_PX) return { kind: 'national' };
  if (resolution > AUTO_ENGAGE_M_PER_PX) return { kind: 'hold' };

  // Too wide for the footprint WFS: fall back to the layer that always covers.
  if (viewport.status === 'zoomedOut') return { kind: 'national' };

  // Kartverket is down and the list is what the cVAT store holds here. The
  // mosaic is no longer the layer that always covers — it draws whatever
  // MapProxy already had and nothing else — so the ranking below runs on the
  // held list unchanged, minus the incumbent rule: there is no seam to pan
  // along when the alternative is a store of nine flights, and the reader
  // arriving here mid-outage should be given the one picture there is.
  if (viewport.status === 'held') {
    const best = viewport.primary[0];
    return best && best.areaRatio >= AUTO_ENGAGE_COVERAGE
      ? { kind: 'project', project: best.project }
      : { kind: 'national' };
  }

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
