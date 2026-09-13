import { transformExtent } from 'ol/proj';
import { metresPerScenePx, sceneToCoord } from './frame';
import type { FunnFrame } from './frame';
import type { SceneElement } from './scene';

/*
 * A stored scene, turned back into pixels.
 *
 * Two callers, wanting the same picture at two resolutions and on two
 * backgrounds. `map/sketchOverlay.ts` asks for a transparent one at whatever
 * the view is showing, because a sketch on the map is a layer over the ground
 * and the ground is the map. `localities/pinQueue.ts` asks for one on paper,
 * at the scene's own resolution, because the pinned figure is the citable
 * artifact and a transparent PNG in a card, in a report or in a takeout bundle
 * is a picture of nothing.
 *
 * Both go through Excalidraw's own renderer rather than a reimplementation of
 * it, which is the only way a sketch and its re-export are the same drawing:
 * the hand-drawn stroke is roughjs seeded per element, and a second opinion
 * about what a wobbly line looks like would make every figure disagree with
 * the surface it was drawn on.
 *
 * ## Why the import is dynamic
 *
 * `@excalidraw/excalidraw` is megabytes, and the module that needs this most
 * is a *map* layer — which is to say it is reachable from the graph
 * `map/atoms.ts` builds the map out of, before any lokalitet is open and
 * whether or not the user will ever press the pen. `session.ts` makes the same
 * point about its own imports. A reader who opens a shared lokalitet to look
 * at it gets the editor only at the moment a sketch actually has to be drawn,
 * and the promise is cached so the second sketch costs nothing.
 *
 * ## Georeferencing
 *
 * `exportToCanvas` frames its output on the drawing, not on the viewport: the
 * canvas covers the elements' common bounds grown by `exportPadding`, at
 * whatever scale `getDimensions` asks for. That is the better rectangle — a
 * sketch is its strokes, not the empty screen around them — but it means the
 * placement has to be computed from the same bounds the exporter used, which
 * is why `getCommonBounds` is called here on the *restored* elements rather
 * than estimated from the raw ones. An estimate that is two pixels out is a
 * drawing two pixels off the terrain it traces, every time it is displayed.
 */

// Room for the stroke itself. Excalidraw's common bounds are the geometry's,
// and a 4 px brush puts 2 px outside them on every side; the default export
// padding exists for exactly this and this is that default.
const EXPORT_PADDING = 10;

/*
 * A ceiling on one export, in device pixels.
 *
 * The overlay re-exports on every zoom step, so this is a frame budget rather
 * than a storage one — 16 Mpx is a 4K viewport at devicePixelRatio 2 with room
 * over, and a canvas past it is a scene somebody has zoomed a long way into
 * rather than a drawing that needs the resolution. The stored figure has its
 * own, larger ceiling in `figure.ts`.
 */
const MAX_RENDER_PIXELS = 16000000;

export type SceneRender = {
  /** The drawing. Transparent unless a background was asked for. */
  canvas: HTMLCanvasElement;
  /** Ground it covers, in `frame.projection`. */
  extent: [number, number, number, number];
  /** Ground it covers, EPSG:25833 — what `meta.bbox25833` wants. */
  bbox25833: [number, number, number, number];
  /** Metres per pixel of `canvas`, at the frame's centre. */
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
   * Device pixels per scene unit. 1 is the resolution the scene was drawn at;
   * the overlay passes the ratio between the frame's metres-per-pixel and the
   * view's, so a sketch drawn zoomed out stays sharp when you zoom into it.
   */
  scale: number;
  /** CSS colour behind the strokes. Omitted means transparent. */
  background?: string;
};

/**
 * Scene → canvas, placed on the ground. Null when there is nothing to draw.
 *
 * Never throws: a sketch that will not render is one card without a picture,
 * and both callers are places where that is the correct outcome — the overlay
 * simply has no layer and the pin queue records a failure with a retry.
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

  // Restored *before* the bounds are read, because `exportToCanvas` restores
  // again on the way in and reads its own bounds off the result. Restoring
  // twice is idempotent; restoring once, on the other side, would put the
  // placement and the pixels on two different rectangles.
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
      // Annotated rather than inferred: the package types this callback
      // loosely enough that it hands its parameters no contextual type, and
      // `noImplicitAny` rejects the arrow that results.
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

  // The exported rectangle, in scene units, then on the ground. Scene y runs
  // down and projected y runs up, so the scene's top-left corner is the
  // ground's north-west and the extent has to be assembled rather than mapped
  // corner for corner.
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
