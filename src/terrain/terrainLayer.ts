import { getDefaultStore } from 'jotai';
import type { Extent } from 'ol/extent';
import ImageLayer from 'ol/layer/Image';
import type { Size } from 'ol/size';
import ImageCanvasSource from 'ol/source/ImageCanvas';
import { mapAtom } from '../map/atoms';

const LAYER_ID = 'terrain.render';

// Over the backgrounds (0) and under the B half of a split (1.5), the LiDAR
// footprints (3) and this rectangle's frame (4). Register: docs/map-layers.md.
const Z_INDEX = 1;

export type TerrainPlacement = {
  canvas: HTMLCanvasElement;
  /** EPSG:25833, the ground `canvas` covers edge to edge (`demImageExtent`). */
  extent25833: [number, number, number, number];
};

let placed: TerrainPlacement | null = null;
let layer: ImageLayer<ImageCanvasSource> | null = null;
// Held outside the layer: the transparency slider moves while nothing is up.
let opacity = 1;
// One viewport-sized output canvas — some 30 MB — reused across frames.
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
  // Nearest-neighbour on the way up: smoothing blurs away the single-pixel step
  // the picture exists to show.
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

// `null` takes the render down. ImageCanvasSource caches one image, so
// `changed()` is the only way to repaint the same canvas.
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
      // Fixed projection, so a view in another one reprojects.
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
