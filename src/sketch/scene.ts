import type { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';

import {
  MAP_SKETCH_COLUMN,
  type SpotRecord,
  type SpotSketch,
} from '../api/spots';
import type { SketchFrame } from './frame';

export type SceneElement = NonNullable<
  ExcalidrawInitialDataState['elements']
>[number];

export type Sketch = {
  frame: SketchFrame;
  elements: readonly SceneElement[];
};

const VOLATILE = ['version', 'versionNonce', 'updated'] as const;

export const storableScene = (
  elements: readonly SceneElement[],
): SceneElement[] =>
  elements
    .filter((el) => !el.isDeleted)
    .map((el) => {
      const copy = { ...el } as Record<string, unknown>;
      for (const key of VOLATILE) delete copy[key];
      return copy as unknown as SceneElement;
    });

export const SKETCH_BUDGET_BYTES = 4000000;

export const sketchBytes = (sketch: SpotSketch | null): number =>
  sketch ? new TextEncoder().encode(JSON.stringify(sketch)).length : 0;

export const sketchOf = (
  value: SpotSketch | null | undefined,
): Sketch | null => {
  if (!value || typeof value !== 'object') return null;
  const frame = value.frame as Partial<SketchFrame> | undefined;
  if (!frame || typeof frame !== 'object') return null;
  if (typeof frame.projection !== 'string' || frame.projection === '') {
    return null;
  }
  if (
    !Array.isArray(frame.extent) ||
    frame.extent.length !== 4 ||
    !frame.extent.every((v) => typeof v === 'number' && Number.isFinite(v))
  ) {
    return null;
  }
  if (
    typeof frame.widthPx !== 'number' ||
    typeof frame.heightPx !== 'number' ||
    !(frame.widthPx > 0) ||
    !(frame.heightPx > 0)
  ) {
    return null;
  }
  if (!Array.isArray(value.elements) || value.elements.length === 0) {
    return null;
  }
  return {
    frame: {
      projection: frame.projection,
      extent: frame.extent as [number, number, number, number],
      widthPx: frame.widthPx,
      heightPx: frame.heightPx,
    },
    elements: value.elements as SceneElement[],
  };
};

export const mapSketchOf = (spot: SpotRecord): Sketch | null => {
  const chosen = spot.mapSketch;
  if (chosen != null && chosen !== '' && chosen !== MAP_SKETCH_COLUMN) {
    return null;
  }
  return sketchOf(spot.sketch);
};
