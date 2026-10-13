

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

export const DEFAULT_FOOTPRINT_SIDE_M = MIN_SIDE_M;

export type DerivedFootprint = {
  bbox: Bbox;

  clamped: 'min' | 'max' | null;
};

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
