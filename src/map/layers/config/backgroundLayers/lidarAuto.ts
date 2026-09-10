// "Automatisk" for the LiDAR dataset: let the viewport choose between the
// national mosaic and a per-acquisition project, instead of pinning one.
//
// The two are good at different scales. The mosaic is a seamless 1 m grid
// over the whole country; a project is a 0.25 m grid over one municipality.
// Zoomed out, a project buys nothing but a coverage hole. Zoomed in, it is
// four times the ground resolution, which for reading earthworks is the
// difference between seeing a ditch and not seeing it. Neither is "the
// right dataset" — the right one depends on how close you are standing.
//
// Auto only decides *what to select*. It writes through the same
// selectNational / selectProject the pulldown uses, so style clamping and
// everything downstream behave identically whether a dataset was picked by
// hand or resolved from the view.

import { halved } from '../../../compare/halves';
import type { LidarProject } from './lidarProjects';
import type { LidarViewportState } from './lidarRelevance';

// Whether the dataset follows the viewport. Cleared by any explicit pick —
// a pulldown row or a W/S press — and set again by the "Automatisk" row.
//
// On by default. At the zoom the app opens at, auto resolves to the
// national mosaic, so a cold load looks exactly as it did before this
// existed; the behaviour only diverges once the user is close enough in for
// the divergence to be an improvement.
//
// Halved like the rest of the ground state, but the two halves start out
// disagreeing on purpose: entering compare clears it on the B side. A half
// that follows the viewport is not a fixed term of comparison, and the whole
// reason to open the curtain is to hold one side still.
export const lidarAutoDatasetHalves = halved(true);
export const lidarAutoDatasetAtom = lidarAutoDatasetHalves.focused;

// Thresholds are map view resolution in metres per pixel. The view is
// EPSG:25833, so that is metres on the ground — and unlike a viewport width
// it does not move with the browser window.
//
// The national mosaic is a 1 m grid, so at 1 m/px it is already at its
// Nyquist limit and a 0.25 m project has nothing further to show on screen.
// Finer than that, every additional detail on screen is the project's.
// That makes 1 m/px the point where switching starts buying resolution
// rather than only costing coverage.
export const AUTO_ENGAGE_M_PER_PX = 1;
// Zoom steps are factor-2 (the view sets constrainResolution), so releasing
// one step further out is the smallest hysteresis there is. Without a gap,
// sitting on the threshold and nudging the zoom swaps the whole background
// stack back and forth — and a swap here is a cross-fade plus a fresh
// screenful of WMS requests, not a cheap redraw.
export const AUTO_RELEASE_M_PER_PX = 2;

// How much of the screen a project must paint before auto hands it the
// background — the majority of it — and how little before auto takes the
// background away again.
//
// Deliberately far above the picker's own minAreaRatio bar (0.1): being
// worth *listing* is a much lower standard than being worth switching to
// unasked. A project covering a tenth of the view would leave the other
// nine tenths on the dimmed national fallback, which is a worse picture
// than the mosaic the user already had.
export const AUTO_ENGAGE_COVERAGE = 0.5;
export const AUTO_RELEASE_COVERAGE = 0.35;

export type LidarAutoChoice =
  | { kind: 'national' }
  | { kind: 'project'; project: LidarProject }
  // Nothing to say: the coverage list is still loading, or the view sits in
  // one of the hysteresis bands. The caller leaves the dataset alone.
  | { kind: 'hold' };

export const chooseAutoDataset = ({
  resolution,
  viewport,
  current,
}: {
  resolution: number | null;
  viewport: LidarViewportState;
  // The active project, or null when the national mosaic is showing.
  // Not simply activeLidarProjectAtom: selecting the mosaic leaves that
  // atom holding the last project, so the caller has to read the
  // background layer to know which of the two is actually on screen.
  current: LidarProject | null;
}): LidarAutoChoice => {
  if (resolution == null) return { kind: 'hold' };
  if (resolution > AUTO_RELEASE_M_PER_PX) return { kind: 'national' };
  if (resolution > AUTO_ENGAGE_M_PER_PX) return { kind: 'hold' };

  // Too wide for the footprint WFS to answer at all. Unreachable at this
  // resolution in practice — MIN_FOOTPRINT_ZOOM is very much further out —
  // but the fallback still has to be the layer that always covers rather
  // than a hold on whatever happened to be selected.
  if (viewport.status === 'zoomedOut') return { kind: 'national' };
  if (viewport.status !== 'ready') return { kind: 'hold' };

  // Keep the incumbent while it still owns a fair share of the screen.
  // Panning along a seam otherwise reshuffles the coverage ranking every
  // few hundred metres, and "a different acquisition is now marginally
  // ahead" is not worth a background swap.
  if (current) {
    const held = viewport.primary.find((e) => e.project.id === current.id);
    if (held && held.areaRatio >= AUTO_RELEASE_COVERAGE) {
      return { kind: 'hold' };
    }
  }

  // `primary` is already ordered by on-screen coverage, then newest, then
  // densest (sortByOnScreenCoverage), and already filtered down to the
  // acquisitions worth opening at all (classifyRelevance). So the rule is
  // simply: auto takes the top of the list the pulldown would have shown.
  // Anything cleverer would make the two disagree, and a picker whose first
  // row is not what "automatic" chose is a picker nobody can predict.
  const best = viewport.primary[0];
  if (best && best.areaRatio >= AUTO_ENGAGE_COVERAGE) {
    return { kind: 'project', project: best.project };
  }
  return { kind: 'national' };
};
