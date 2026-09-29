// The ground a drawing covers. Excalidraw's own `getCommonBounds` is exact for
// a rotated element, but it lives in the lazy editor bundle and this only seeds
// a rectangle the reader then adjusts, or culls a drawing against the
// viewport, so the elements' own boxes will do.

import { transformExtent } from 'ol/proj';

import type { Bbox } from '../map/bbox';
import { sceneToCoord } from './frame';
import type { Sketch } from './scene';

/** The drawing's own ground, in `projection`. Null when no element has a
 *  finite box. */
export const sketchExtentIn = (
  sketch: Sketch,
  projection: string,
): [number, number, number, number] | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const element of sketch.elements) {
    const { x, y, width, height } = element;
    if (![x, y, width, height].every((v) => Number.isFinite(v))) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }
  if (!(minX <= maxX)) return null;

  // Scene y runs down the screen and projected y up, so the scene's top-left
  // corner is the ground's north-west: the extent is assembled, not mapped
  // corner for corner.
  const [west, north] = sceneToCoord(sketch.frame, minX, minY);
  const [east, south] = sceneToCoord(sketch.frame, maxX, maxY);
  const extent: [number, number, number, number] = [west, south, east, north];

  return sketch.frame.projection === projection
    ? extent
    : (transformExtent(extent, sketch.frame.projection, projection) as [
        number,
        number,
        number,
        number,
      ]);
};

export const sketchBbox = (sketch: Sketch): Bbox | null =>
  sketchExtentIn(sketch, 'EPSG:4326') as Bbox | null;
