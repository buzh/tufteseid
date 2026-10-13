

import type Map from 'ol/Map';
import { getPointResolution, transformExtent } from 'ol/proj';

import type { SpotSketch } from '../api/spots';

export type SketchFrame = SpotSketch['frame'];

export const captureFrame = (map: Map): SketchFrame | null => {
  const size = map.getSize();
  if (!size || size[0] < 1 || size[1] < 1) return null;
  const view = map.getView();
  const extent = view.calculateExtent(size);
  return {
    projection: view.getProjection().getCode(),
    extent: [extent[0], extent[1], extent[2], extent[3]],
    widthPx: size[0],
    heightPx: size[1],
  };
};

export const sceneToCoord = (
  frame: SketchFrame,
  x: number,
  y: number,
): [number, number] => {
  const [minX, minY, maxX, maxY] = frame.extent;
  return [
    minX + (x / frame.widthPx) * (maxX - minX),

    maxY - (y / frame.heightPx) * (maxY - minY),
  ];
};

export const frameExtentIn = (
  frame: SketchFrame,
  projection: string,
): [number, number, number, number] => {
  if (projection === frame.projection) return frame.extent;
  return transformExtent(frame.extent, frame.projection, projection) as [
    number,
    number,
    number,
    number,
  ];
};

export const metresPerScenePx = (frame: SketchFrame): number => {
  const [minX, minY, maxX, maxY] = frame.extent;
  const unitsPerPx = (maxX - minX) / frame.widthPx;
  return (
    getPointResolution(frame.projection, unitsPerPx, [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
    ]) || unitsPerPx
  );
};
