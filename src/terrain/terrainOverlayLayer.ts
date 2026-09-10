// The terrain render, on the map itself.
//
// Terrenganalyse exists so relief can be read *against* everything else on
// the map — the Kulturminner layers, a lokalitet's rectangle, the funn drawn
// on it. A thumbnail in a ribbon row cannot do that however well it is
// letterboxed, so the rendered DEM goes down as a georeferenced image layer
// over the background, at the exact ground it was computed for.
//
// Imperative and module-level, like `swapBackgroundLayers`, rather than an
// atom plus a hook. Two of the three things that change here — the pixels on
// every slider frame, the opacity on every drag of its own — change dozens of
// times a second and no React component needs to see either. Routing them
// through jotai would re-render the whole shell at that rate for nothing.
//
// The canvas is *the same element* useTerrainAnalysis paints into and saves
// from; nothing is copied. Repaints land in place, so the identity never
// changes and the source has no way of noticing its cached image went stale —
// which is why `showTerrainOverlay` is also the repaint call.

import { getDefaultStore } from 'jotai';
import type { Extent } from 'ol/extent';
import ImageLayer from 'ol/layer/Image';
import type { Size } from 'ol/size';
import ImageCanvasSource from 'ol/source/ImageCanvas';
import { mapAtom } from '../map/atoms';

const LAYER_ID = 'terrain.overlay';

// Over the background stack, which sets no zIndex at all (i.e. 0), and under
// everything drawn on top of it: the lokalitet rectangles (4), the funn (5)
// and the theme layers (10). Putting the heritage record on top of the relief
// is the whole point, so the relief has to be the ground.
const Z_INDEX = 1;

export type TerrainPlacement = {
  /** Painted in place by useTerrainAnalysis. Never copied. */
  canvas: HTMLCanvasElement;
  /** EPSG:25833. The ground the canvas covers, edge to edge. */
  extent25833: [number, number, number, number];
};

let layer: ImageLayer<ImageCanvasSource> | null = null;
let placement: TerrainPlacement | null = null;
let opacity = 1;

// One output canvas for the layer's whole life rather than one per call.
// ImageCanvasSource explicitly supports a reused element — that is what
// `changed()` is for — and the alternative is allocating a viewport-sized
// canvas (30 MB on a 4K display at devicePixelRatio 2) on every frame of a
// slider drag.
let out: HTMLCanvasElement | null = null;

const drawFrame = (
  extent: Extent,
  resolution: number,
  pixelRatio: number,
  size: Size,
): HTMLCanvasElement => {
  out ??= document.createElement('canvas');
  const width = Math.round(size[0]);
  const height = Math.round(size[1]);
  if (out.width !== width || out.height !== height) {
    out.width = width;
    out.height = height;
  }
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  ctx.clearRect(0, 0, width, height);
  if (!placement) return out;

  const [minX, minY, maxX, maxY] = placement.extent25833;
  // Ground metres → canvas pixels.
  const scale = pixelRatio / resolution;
  const w = (maxX - minX) * scale;
  const h = (maxY - minY) * scale;
  // Nearest-neighbour once a DEM pixel is larger than a screen pixel:
  // smoothing on upscale blurs away precisely the single-pixel step — a ditch
  // edge, the lip of a mound — that the visualization exists to show. On
  // downscale it is the other way round and averaging helps.
  ctx.imageSmoothingEnabled = w < placement.canvas.width;
  ctx.drawImage(
    placement.canvas,
    (minX - extent[0]) * scale,
    (extent[3] - maxY) * scale,
    w,
    h,
  );
  return out;
};

/**
 * Show the render, move it to a new rectangle, or announce that its pixels
 * changed under us — all three are the same call, because the source caches
 * one image and `changed()` is the only way to invalidate it. Building the
 * layer once and re-asking it for its image is also what keeps re-framing and
 * every slider frame from flashing.
 */
export const showTerrainOverlay = (next: TerrainPlacement) => {
  placement = next;
  if (!layer) {
    layer = new ImageLayer({
      source: new ImageCanvasSource({
        // Fixed, so a view in any of the app's other projections gets the
        // render reprojected rather than placed wrong.
        projection: 'EPSG:25833',
        canvasFunction: drawFrame,
      }),
      zIndex: Z_INDEX,
      opacity,
      properties: { id: LAYER_ID },
    });
    getDefaultStore().get(mapAtom).addLayer(layer);
    return;
  }
  layer.getSource()?.changed();
};

/** 0..1. Fades the render towards whatever it is covering. */
export const setTerrainOverlayOpacity = (value: number) => {
  opacity = value;
  layer?.setOpacity(value);
};

// The remembered opacity deliberately survives this: switching DTM→DOM tears
// the layer down and rebuilds it, and losing the fade you had just dialled in
// on the way through would be a bug. useTerrainAnalysis pushes its own value
// on mount, so a fresh session of the tool still starts where its slider says.
export const hideTerrainOverlay = () => {
  if (layer) getDefaultStore().get(mapAtom).removeLayer(layer);
  layer = null;
  placement = null;
  out = null;
};
