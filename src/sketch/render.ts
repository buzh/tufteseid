// A stored drawing re-exported to pixels at the view's resolution.
// `exportToCanvas` frames on the drawing's common bounds grown by
// `exportPadding`, not on the viewport, so the placement below is computed from
// those same bounds.

// Must stay first, above the imports below: the dynamic import in
// `excalidraw()` is the second way into the editor bundle, which reads the font
// path off the global as it evaluates. A spot opened from a short link renders
// here without `SketchCanvas` ever mounting.
import './excalidrawAssets';
import { transformExtent } from 'ol/proj';

import { sceneToCoord, type SketchFrame } from './frame';
import type { SceneElement } from './scene';

// Scene units. Common bounds are the geometry's, so a stroke sits partly
// outside them; this is Excalidraw's own default padding for that.
const EXPORT_PADDING = 10;

// A frame budget, not a storage one: the overlay re-exports on every zoom step.
const MAX_RENDER_PIXELS = 16000000;

export type SceneRender = {
  /** Transparent. */
  canvas: HTMLCanvasElement;
  /** Ground the canvas covers, in EPSG:25833 — the overlay's own projection. */
  extent25833: [number, number, number, number];
};

type ExcalidrawModule = typeof import('@excalidraw/excalidraw');

let modulePromise: Promise<ExcalidrawModule> | null = null;

const excalidraw = (): Promise<ExcalidrawModule> => {
  modulePromise ??= import('@excalidraw/excalidraw');
  return modulePromise;
};

/**
 * Drawing → canvas, placed on the ground. Never throws; null when there is
 * nothing to draw or the export failed. `scale` is device pixels per scene
 * unit, 1 being the resolution the drawing was made at.
 */
export const renderScene = async (
  frame: SketchFrame,
  elements: readonly SceneElement[],
  scale: number,
): Promise<SceneRender | null> => {
  if (elements.length === 0) return null;
  let mod: ExcalidrawModule;
  try {
    mod = await excalidraw();
  } catch (e) {
    console.warn('[sketch] editor bundle failed to load', e);
    modulePromise = null;
    return null;
  }

  // Restored before the bounds are read: `exportToCanvas` restores again on
  // the way in and reads its bounds off that, so restoring only on its side
  // would put the placement and the pixels on two different rectangles.
  // Guarded because `sketchOf` checks the frame, not the elements, and one
  // malformed element throws out of Excalidraw's own code.
  let restored: ReturnType<ExcalidrawModule['restoreElements']>;
  let bounds: ReturnType<ExcalidrawModule['getCommonBounds']>;
  try {
    restored = mod
      .restoreElements(elements, null)
      .filter((el) => !el.isDeleted);
    if (restored.length === 0) return null;
    bounds = mod.getCommonBounds(restored);
  } catch (e) {
    console.warn('[sketch] scene could not be restored', e);
    return null;
  }

  const [minX, minY, maxX, maxY] = bounds;
  const sceneWidth = maxX - minX + EXPORT_PADDING * 2;
  const sceneHeight = maxY - minY + EXPORT_PADDING * 2;
  if (!(sceneWidth > 0) || !(sceneHeight > 0)) return null;

  const wanted = Math.max(scale, 0.01);
  const budget = Math.sqrt(
    MAX_RENDER_PIXELS / (sceneWidth * sceneHeight * wanted * wanted),
  );
  const drawn = budget < 1 ? wanted * budget : wanted;

  let canvas: HTMLCanvasElement;
  try {
    canvas = await mod.exportToCanvas({
      elements: restored,
      files: null,
      exportPadding: EXPORT_PADDING,
      appState: {
        exportBackground: false,
        viewBackgroundColor: 'transparent',
        exportWithDarkMode: false,
      },
      // Annotated: the package gives this callback's parameters no contextual
      // type, which `noImplicitAny` rejects.
      getDimensions: (width: number, height: number) => ({
        width: Math.max(1, Math.round(width * drawn)),
        height: Math.max(1, Math.round(height * drawn)),
        scale: drawn,
      }),
    });
  } catch (e) {
    console.warn('[sketch] export failed', e);
    return null;
  }

  // Scene y runs down, projected y up: the scene's top-left is the ground's
  // north-west, so the extent is assembled, not mapped corner for corner.
  const [west, north] = sceneToCoord(
    frame,
    minX - EXPORT_PADDING,
    minY - EXPORT_PADDING,
  );
  const [east, south] = sceneToCoord(
    frame,
    maxX + EXPORT_PADDING,
    maxY + EXPORT_PADDING,
  );
  const extent: [number, number, number, number] = [west, south, east, north];

  return {
    canvas,
    extent25833:
      frame.projection === 'EPSG:25833'
        ? extent
        : (transformExtent(extent, frame.projection, 'EPSG:25833') as [
            number,
            number,
            number,
            number,
          ]),
  };
};
