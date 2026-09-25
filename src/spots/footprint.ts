// Every spot has a rectangle. It is what the pictures are rendered over, so a
// spot without one can hold none — and the reader is never asked for it up
// front: the first write that finds a record without one derives it here, and
// adjusting it afterwards is a separate act.

import type { SpotPoint, SpotSketch } from '../api/spots';
import {
  bboxToMetric,
  MAX_SIDE_M,
  MIN_SIDE_M,
  squareBboxAround,
  squareBboxCovering,
  type Bbox,
} from '../map/bbox';
import { sketchBbox } from '../sketch/bounds';
import { sketchOf } from '../sketch/scene';

/** What a spot gets when there is nothing but the pin to go on. */
export const DEFAULT_FOOTPRINT_SIDE_M = MIN_SIDE_M;

export type DerivedFootprint = {
  bbox: Bbox;
  /** The drawing's own span fell outside `MIN_SIDE_M`…`MAX_SIDE_M`, so the
   *  square is not what was drawn. */
  clamped: 'min' | 'max' | null;
};

/** The square around the drawing if there is one, and otherwise the default
 *  around the pin. */
export const derivedFootprint = (
  point: SpotPoint,
  sketch: SpotSketch | null,
): DerivedFootprint => {
  const drawn = sketchOf(sketch);
  const bounds = drawn ? sketchBbox(drawn) : null;
  if (!bounds) {
    return {
      bbox: squareBboxAround(point, DEFAULT_FOOTPRINT_SIDE_M),
      clamped: null,
    };
  }

  const [minX, minY, maxX, maxY] = bboxToMetric(bounds);
  const span = Math.max(maxX - minX, maxY - minY);
  return {
    bbox: squareBboxCovering(bounds),
    clamped: span < MIN_SIDE_M ? 'min' : span > MAX_SIDE_M ? 'max' : null,
  };
};
