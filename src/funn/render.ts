import { transformExtent } from 'ol/proj';
import { metresPerScenePx, sceneToCoord } from './frame';
import type { FunnFrame } from './frame';
import type { SceneElement } from './scene';

// A stored scene, turned back into pixels: transparent at view resolution for
// `map/sketchOverlay.ts`, on paper at the scene's own for `localities/pinQueue.ts`.
// The import of `@excalidraw/excalidraw` is dynamic and its promise cached —
// megabytes, and this module is reachable from the map graph before any
// lokalitet is open. `exportToCanvas` frames on the drawing's common bounds
// grown by `exportPadding`, not on the viewport, so the placement below is
// computed from those same bounds: an estimate two pixels out is a drawing two
// pixels off the terrain it traces, every time it is displayed.

// Scene units. Common bounds are the geometry's, so a brush stroke sits partly
// outside them; this is Excalidraw's own default padding for that.
const EXPORT_PADDING = 10;

// A frame budget, not a storage one: the overlay re-exports on every zoom step.
// The stored figure has its own, larger ceiling in `figure.ts`.
const MAX_RENDER_PIXELS = 16000000;

export type SceneRender = {
  /** Transparent unless a background was asked for. */
  canvas: HTMLCanvasElement;
  /** Ground it covers, in `frame.projection`. */
  extent: [number, number, number, number];
  bbox25833: [number, number, number, number];
  /** Of `canvas`, at the frame's centre. */
  metresPerPx: number;
};

type ExcalidrawModule = typeof import('@excalidraw/excalidraw');

let modulePromise: Promise<ExcalidrawModule> | null = null;

const excalidraw = (): Promise<ExcalidrawModule> => {
  modulePromise ??= import('@excalidraw/excalidraw');
  return modulePromise;
};

export type RenderSceneOptions = {
  /**
   * Device pixels per scene unit; 1 is the resolution the scene was drawn at.
   * The overlay passes the ratio of the frame's metres-per-pixel to the view's.
   */
  scale: number;
  /** CSS colour behind the strokes. Omitted means transparent. */
  background?: string;
};

/**
 * Scene → canvas, placed on the ground. Never throws; null when there is
 * nothing to draw or the export failed.
 */
export const renderScene = async (
  frame: FunnFrame,
  elements: readonly SceneElement[],
  options: RenderSceneOptions,
): Promise<SceneRender | null> => {
  if (elements.length === 0) return null;
  let mod: ExcalidrawModule;
  try {
    mod = await excalidraw();
  } catch (e) {
    console.warn('[funn/render] editor bundle failed to load', e);
    modulePromise = null;
    return null;
  }

  // Restored before the bounds are read: `exportToCanvas` restores again on the
  // way in and reads its own bounds off that, and restoring only on its side
  // would put the placement and the pixels on two different rectangles.
  const restored = mod
    .restoreElements(elements, null)
    .filter((el) => !el.isDeleted);
  if (restored.length === 0) return null;

  const [minX, minY, maxX, maxY] = mod.getCommonBounds(restored);
  const sceneWidth = maxX - minX + EXPORT_PADDING * 2;
  const sceneHeight = maxY - minY + EXPORT_PADDING * 2;
  if (!(sceneWidth > 0) || !(sceneHeight > 0)) return null;

  const wanted = Math.max(options.scale, 0.01);
  const budget = Math.sqrt(
    MAX_RENDER_PIXELS / (sceneWidth * sceneHeight * wanted * wanted),
  );
  const scale = budget < 1 ? wanted * budget : wanted;

  let canvas: HTMLCanvasElement;
  try {
    canvas = await mod.exportToCanvas({
      elements: restored,
      files: null,
      exportPadding: EXPORT_PADDING,
      appState: {
        exportBackground: options.background != null,
        viewBackgroundColor: options.background ?? 'transparent',
        exportWithDarkMode: false,
      },
      // Annotated because the package gives this callback's parameters no
      // contextual type, which `noImplicitAny` rejects.
      getDimensions: (width: number, height: number) => ({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        scale,
      }),
    });
  } catch (e) {
    console.warn('[funn/render] export failed', e);
    return null;
  }

  // Scene y runs down and projected y runs up, so the scene's top-left corner
  // is the ground's north-west: the extent is assembled, not mapped corner for
  // corner.
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
    extent,
    bbox25833:
      frame.projection === 'EPSG:25833'
        ? extent
        : (transformExtent(extent, frame.projection, 'EPSG:25833') as [
            number,
            number,
            number,
            number,
          ]),
    metresPerPx: metresPerScenePx(frame) / scale,
  };
};
