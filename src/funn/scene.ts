import type { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import type { FunnFrame } from './frame';

/*
 * The scene, as something that can be stored.
 *
 * An Excalidraw scene in memory is a mutable working document: every element
 * carries a version counter, a random nonce and a timestamp that change on
 * each pointer sample, and deleted elements stay in the array as tombstones so
 * undo can bring them back. None of that is worth keeping. Two of the three
 * change when *nothing* has, which would make an unchanged drawing look dirty
 * to the autosave and write a new copy of it every 700 ms; the tombstones are
 * an undo stack, and undo does not survive the session that made it.
 *
 * So what a sketch stores is the live elements with the churn taken off — and
 * `restore()` on the way back in puts the missing fields back at their
 * defaults, which is exactly what `@excalidraw/excalidraw` exists to do for
 * documents that have been round-tripped through somebody else's store.
 *
 * `seed` is deliberately **not** stripped. It is what makes the hand-drawn
 * stroke deterministic: drop it and every re-render of the same drawing wobbles
 * somewhere else, so a sketch would not be the same picture twice and the
 * pinned figure would not be a picture of the record.
 *
 * The element type is derived from `initialData` rather than imported from
 * `@excalidraw/excalidraw/element/types`. Same type, and it comes from the
 * entry point the package actually documents — a deep path into a bundler's
 * output is a thing that breaks on a patch release.
 */
export type SceneElement = NonNullable<
  ExcalidrawInitialDataState['elements']
>[number];

/** What a sketch's `meta` carries beyond the usual View fields. */
export type SketchScene = {
  frame: FunnFrame;
  elements: SceneElement[];
};

/*
 * The volatile trio. Everything else about an element is either what was drawn
 * or how it was drawn, and both are the document.
 */
const VOLATILE = ['version', 'versionNonce', 'updated'] as const;

/** Live elements only, with the per-sample churn removed. */
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

/*
 * How much scene a record may carry.
 *
 * Two ceilings sit above this one and neither is a good place to find out you
 * have crossed it: `attachments.meta` is capped at 2 MB server-side
 * (1700000700), and the edit buffer holding the unsaved sketch is
 * `localStorage`, whose quota is per origin and shared with every other draft
 * — a write that does not fit is swallowed there (`draft.ts`), so the failure
 * mode is a recovery copy that silently is not one.
 *
 * 1 MB is where the budget is drawn: comfortably inside both, and some
 * hundreds of freedraw strokes at full point density, which is far more
 * drawing than one frozen viewport holds. Crossing it is refused at the moment
 * of keeping, with a sentence, rather than at the moment of saving.
 */
export const SCENE_BUDGET_BYTES = 1000000;

export const sceneBytes = (elements: readonly SceneElement[]): number =>
  JSON.stringify(elements).length;

/*
 * A sketch's `meta`, on the way in.
 *
 * Re-checked field by field for the same reason `viewSpecOf` re-checks a
 * terrain spec: `meta` is a free-form JSON column, and a scene that restores
 * against a frame it was not drawn on is not a degraded drawing — it is the
 * right strokes over the wrong ground, which looks like it worked.
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
