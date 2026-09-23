import type { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';

import type { SpotSketch } from '../api/spots';
import type { SketchFrame } from './frame';

export type SceneElement = NonNullable<
  ExcalidrawInitialDataState['elements']
>[number];

/** `SpotSketch` with its `unknown[]` resolved, after checking. */
export type Sketch = {
  frame: SketchFrame;
  elements: readonly SceneElement[];
};

// Change on every pointer sample, so keeping them makes an unchanged drawing
// look dirty. `seed` is *not* stripped: it is what keeps a hand-drawn stroke
// deterministic between renders.
const VOLATILE = ['version', 'versionNonce', 'updated'] as const;

/** Editor elements → the stored form; `isDeleted` tombstones are dropped. */
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

// Inside the server's ceiling: `spots.sketch` is capped at 5 MB
// (`pb_migrations/1700001100_spots.js`).
export const SKETCH_BUDGET_BYTES = 4000000;

// UTF-8 bytes, not `String.length`: the server cap is in bytes, and æ/ø/å cost
// two apiece.
export const sketchBytes = (sketch: SpotSketch | null): number =>
  sketch ? new TextEncoder().encode(JSON.stringify(sketch)).length : 0;

/** A stored sketch, re-checked field by field: it is a free-form JSON column,
 *  and a bad frame draws the right strokes over the wrong ground. */
export const sketchOf = (value: SpotSketch | null | undefined): Sketch | null => {
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
