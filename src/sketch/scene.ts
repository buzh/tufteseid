// What a drawing is once it has stopped being an editor session: the elements
// Excalidraw hands over, with the per-sample churn taken off, plus the frame
// that says which ground they are over.

import type { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';

import type { SpotSketch } from '../api/spots';
import type { SketchFrame } from './frame';

/** One shape. Opaque here: only Excalidraw reads inside it. */
export type SceneElement = NonNullable<
  ExcalidrawInitialDataState['elements']
>[number];

/** `SpotSketch` with its `unknown[]` resolved, after it has been checked. */
export type Sketch = {
  frame: SketchFrame;
  elements: readonly SceneElement[];
};

// These change on every pointer sample, so keeping them makes an unchanged
// drawing look dirty. `seed` is *not* stripped — it is what makes the
// hand-drawn stroke deterministic, and without it a re-render of the same
// drawing wobbles somewhere else.
const VOLATILE = ['version', 'versionNonce', 'updated'] as const;

/**
 * Editor elements → the stored form. Tombstones go: undo has to work right up
 * to the moment something is kept, and this is that moment.
 */
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

// Drawn inside the server's ceiling: `spots.sketch` is capped at 5 MB
// (`pb_migrations/1700001100_spots.js`), and a drawing that only fails at
// `Lagre` has already cost the reader the work.
export const SKETCH_BUDGET_BYTES = 4000000;

// UTF-8 bytes, not `String.length`: the cap is measured in bytes, and this is a
// Norwegian app, so æ/ø/å in a label inside a drawing is ordinary and costs two
// bytes to the code unit's one.
export const sketchBytes = (sketch: SpotSketch | null): number =>
  sketch ? new TextEncoder().encode(JSON.stringify(sketch)).length : 0;

/**
 * A stored sketch, re-checked field by field: it is a free-form JSON column,
 * and strokes restored against a frame they were not drawn on are the right
 * drawing over the wrong ground, which looks like it worked.
 */
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
