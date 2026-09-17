import type { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import type { FunnFrame } from './frame';

// A stored scene is the live elements with the per-sample churn taken off;
// `restore()` puts the stripped defaults back on the way in. `seed` is not
// stripped — it is what makes the hand-drawn stroke deterministic, so without
// it a re-render of the same sketch wobbles somewhere else.
export type SceneElement = NonNullable<
  ExcalidrawInitialDataState['elements']
>[number];

/** What a sketch's `meta` carries beyond the usual View fields. */
export type SketchScene = {
  frame: FunnFrame;
  elements: SceneElement[];
};

// These change on every pointer sample, so keeping them makes an unchanged
// drawing look dirty and the autosave rewrites it every 700 ms.
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

// 1 MB, drawn inside the two ceilings above it: `attachments.meta` is capped at
// 2 MB server-side, and the `localStorage` edit buffer swallows an oversized
// write (`draft.ts`), leaving a recovery copy that silently is not one.
export const SCENE_BUDGET_BYTES = 1000000;

// UTF-8 bytes, not `String.length`: both ceilings are measured in bytes, and
// this is a Norwegian app, so æ/ø/å in a caption inside a scene is ordinary and
// costs two bytes to the code unit's one.
export const sceneBytes = (elements: readonly SceneElement[]): number =>
  new TextEncoder().encode(JSON.stringify(elements)).length;

/**
 * A sketch's `meta`, re-checked field by field: it is a free-form JSON column,
 * and a scene restored against a frame it was not drawn on is the right strokes
 * over the wrong ground, which looks like it worked.
 */
export const sketchSceneOf = (
  meta: Record<string, unknown> | null,
): SketchScene | null => {
  if (!meta) return null;
  const frame = meta.frame as Partial<FunnFrame> | undefined;
  const elements = meta.scene;
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
  if (!Array.isArray(elements) || elements.length === 0) return null;
  return {
    frame: {
      projection: frame.projection,
      extent: frame.extent as [number, number, number, number],
      widthPx: frame.widthPx,
      heightPx: frame.heightPx,
    },
    elements: elements as SceneElement[],
  };
};
