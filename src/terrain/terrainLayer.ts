import { getDefaultStore } from 'jotai';
import type { Extent } from 'ol/extent';
import ImageLayer from 'ol/layer/Image';
import type { Size } from 'ol/size';
import ImageCanvasSource from 'ol/source/ImageCanvas';
import { mapAtom } from '../map/atoms';

const LAYER_ID = 'terrain.render';

const Z_INDEX = 1;

export type TerrainPlacement = {
  canvas: HTMLCanvasElement;
  extent25833: [number, number, number, number];
};

let placed: TerrainPlacement | null = null;
let layer: ImageLayer<ImageCanvasSource> | null = null;
let opacity = 1;
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
