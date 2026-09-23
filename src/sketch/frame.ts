// Scene ↔ ground. Scene units are CSS pixels of the frozen viewport, origin
// top-left, y downwards. The extent is in the view projection at freeze, not
// EPSG:4326 like `spot.point`. Rotation is locked off (`map/atoms.ts`), so the
// mapping is linear.

import type Map from 'ol/Map';
import { getPointResolution, transformExtent } from 'ol/proj';

import type { SpotSketch } from '../api/spots';

export type SketchFrame = SpotSketch['frame'];

/** Null before the map has a size, i.e. before first layout. */
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

/** Scene point → ground coordinate, in the frame's own projection. */
export const sceneToCoord = (
  frame: SketchFrame,
  x: number,
  y: number,
): [number, number] => {
  const [minX, minY, maxX, maxY] = frame.extent;
  return [
    minX + (x / frame.widthPx) * (maxX - minX),
    // Scene y runs down the screen; projected y runs up the map.
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

/** Metres one scene unit covers, at the frame's centre. Via
 *  `getPointResolution`: the frame's projection may be EPSG:4326 (degrees) or
 *  EPSG:3857 (metres inflated by latitude). */
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
