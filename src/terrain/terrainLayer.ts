// The terrain render on the map: one georeferenced canvas over the background,
// declared by `useTerrainControls` and drawn until it is withdrawn.
//
// Module-level and imperative rather than an atom effect, because the pixels
// change dozens of times a second and the element they change in does not: the
// controller paints every slider frame into the same canvas, so there is no new
// identity for React or Jotai to notice. `setTerrainRender` is therefore the
// repaint call as much as the placement call — `ImageCanvasSource` caches one
// image, and `changed()` is the only way to invalidate it.
//
// One member, not a stack. The old interface composited a lokalitet's kept
// renders and pinned images into the same layer; nothing on this branch keeps
// anything, and a registry for a single member would be a shape with no second
// case to justify it.

import { getDefaultStore } from 'jotai';
import type { Extent } from 'ol/extent';
import ImageLayer from 'ol/layer/Image';
import type { Size } from 'ol/size';
import ImageCanvasSource from 'ol/source/ImageCanvas';
import { mapAtom } from '../map/atoms';

const LAYER_ID = 'terrain.render';

// Over the backgrounds (zIndex 0) and under everything above them: the B half
// of a two-ground view at 1.5 covers it, which is right — the analysis belongs
// to the A ground and is read off the main map — the LiDAR footprint outlines
// at 3 and this rectangle's own frame at 4 draw over it. `docs/map-layers.md`
// keeps the register.
const Z_INDEX = 1;

export type TerrainPlacement = {
  /** Painted by `paintTerrainField`, and reused across frames. */
  canvas: HTMLCanvasElement;
  /** EPSG:25833, the ground `canvas` covers edge to edge (`demImageExtent`). */
  extent25833: [number, number, number, number];
};

let placed: TerrainPlacement | null = null;
let layer: ImageLayer<ImageCanvasSource> | null = null;
// Held outside the layer: the transparency slider moves while nothing is up
// (a DTM→DOM swap withdraws the render and declares a new one), and the value
// has to survive to whatever comes back.
let opacity = 1;
// One output canvas, reused. It is viewport-sized — some 30 MB — and a slider
// drag would otherwise reallocate it every frame.
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
  if (!placed) return out;

  const scale = pixelRatio / resolution;
  const [minX, minY, maxX, maxY] = placed.extent25833;
  const w = (maxX - minX) * scale;
  const h = (maxY - minY) * scale;
  // Nearest-neighbour on the way up — smoothing blurs away the single-pixel
  // step the picture exists to show — and averaging on the way down.
  ctx.imageSmoothingEnabled = w < placed.canvas.width;
  ctx.drawImage(
    placed.canvas,
    (minX - extent[0]) * scale,
    (extent[3] - maxY) * scale,
    w,
    h,
  );
  return out;
};

/**
 * Put the render up, move it, announce that its pixels changed, or — with
 * `null` — take it down and free the output canvas with it.
 */
export const setTerrainRender = (next: TerrainPlacement | null) => {
  placed = next;
  const map = getDefaultStore().get(mapAtom);
  if (!next) {
    if (layer) map.removeLayer(layer);
    layer = null;
    out = null;
    return;
  }
  if (!layer) {
    layer = new ImageLayer({
      // Fixed, so a view in another projection reprojects.
      source: new ImageCanvasSource({
        projection: 'EPSG:25833',
        canvasFunction: drawFrame,
      }),
      zIndex: Z_INDEX,
      opacity,
      properties: { id: LAYER_ID },
    });
    map.addLayer(layer);
    return;
  }
  layer.getSource()?.changed();
};

export const setTerrainOpacity = (value: number) => {
  if (opacity === value) return;
  opacity = value;
  layer?.setOpacity(value);
};
