import './excalidrawAssets';
import type { Extent } from 'ol/extent';
import { transformExtent } from 'ol/proj';

import { sceneToCoord, type SketchFrame } from './frame';
import type { SceneElement } from './scene';

const EXPORT_PADDING = 10;

const MAX_RENDER_PIXELS = 16000000;

export type SceneRender = {
  canvas: HTMLCanvasElement;
  extent25833: [number, number, number, number];
};

type ExcalidrawModule = typeof import('@excalidraw/excalidraw');

let modulePromise: Promise<ExcalidrawModule> | null = null;

const excalidraw = (): Promise<ExcalidrawModule> => {
  modulePromise ??= import('@excalidraw/excalidraw');
  return modulePromise;
};

export const renderScene = async (
  frame: SketchFrame,
  elements: readonly SceneElement[],
  scale: number,
  maxPixels: number = MAX_RENDER_PIXELS,
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
    maxPixels / (sceneWidth * sceneHeight * wanted * wanted),
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

export const paintRender = (
  ctx: CanvasRenderingContext2D,
  render: SceneRender,
  extent: Extent,
  resolution: number,
  pixelRatio: number,
): void => {
  const [minX, minY, maxX, maxY] = render.extent25833;
  const scale = pixelRatio / resolution;
  const width = (maxX - minX) * scale;
  const height = (maxY - minY) * scale;
  if (!(width > 0) || !(height > 0)) return;
  ctx.drawImage(
    render.canvas,
    0,
    0,
    render.canvas.width,
    render.canvas.height,
    (minX - extent[0]) * scale,
    (extent[3] - maxY) * scale,
    width,
    height,
  );
};
