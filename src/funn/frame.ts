import Map from 'ol/Map';
import { getPointResolution, transformExtent } from 'ol/proj';
import type { LocalityBbox } from '../api/localities';

/*
 * The one transform between an Excalidraw scene and the ground.
 *
 * Drawing a funn freezes the map: the view stops moving, and Excalidraw draws
 * over it on a transparent canvas in its own scene coordinates. A frame is
 * what makes those coordinates mean something — it is captured once when the
 * pen goes down and never changes while it is down, which is the whole reason
 * this can be four numbers and a size rather than a live projection.
 *
 * Scene units are the **CSS pixels of the frozen viewport**, origin top-left,
 * y downwards — so a scene coordinate is a pixel of the view the user was
 * looking at when they started, and the map element can be transformed to
 * follow the scene rather than the other way round (`session.ts`).
 *
 * The extent is stored in the **view projection at freeze**, not in EPSG:4326
 * like `localities.bbox`. That is deliberate: rotation is locked off
 * (`map/atoms.ts`), so in a projected CRS the scene↔ground mapping is exactly
 * linear, and storing degrees instead would make the y axis subtly non-linear
 * across a tall viewport for no gain. Degrees are derived at the edges, where
 * something actually wants them.
 */
export type FunnFrame = {
  /** The map's projection when the pen went down, e.g. 'EPSG:25833'. */
  projection: string;
  /** Ground covered by the frozen viewport, in `projection`. */
  extent: [number, number, number, number];
  /** Scene units across and down — CSS pixels of the frozen viewport. */
  widthPx: number;
  heightPx: number;
};

/** The frame for the view as it stands. Null before the map has a size. */
export const captureFunnFrame = (map: Map): FunnFrame | null => {
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
  frame: FunnFrame,
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

/** Ground coordinate (frame projection) → scene point. */
export const coordToScene = (
  frame: FunnFrame,
  coord: [number, number],
): [number, number] => {
  const [minX, minY, maxX, maxY] = frame.extent;
  return [
    ((coord[0] - minX) / (maxX - minX)) * frame.widthPx,
    ((maxY - coord[1]) / (maxY - minY)) * frame.heightPx,
  ];
};

/**
 * A rectangle in scene units → the ground it covers, EPSG:4326.
 *
 * This is what grow-to-fit reads: `funnOutsideAtom` needs the drawing's
 * extent in the same coordinates as `locality.bbox` to answer whether the pen
 * has left the rectangle.
 */
export const sceneExtentToBbox4326 = (
  frame: FunnFrame,
  scene: [number, number, number, number],
): LocalityBbox => {
  const [aX, aY] = sceneToCoord(frame, scene[0], scene[1]);
  const [bX, bY] = sceneToCoord(frame, scene[2], scene[3]);
  const inFrame: [number, number, number, number] = [
    Math.min(aX, bX),
    Math.min(aY, bY),
    Math.max(aX, bX),
    Math.max(aY, bY),
  ];
  if (frame.projection === 'EPSG:4326') return inFrame;
  return transformExtent(inFrame, frame.projection, 'EPSG:4326') as LocalityBbox;
};

/** The frame's own extent, for placing a rendered funn on a live map. */
export const frameExtentIn = (
  frame: FunnFrame,
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

/**
 * How many metres one scene unit covers, at the frame's centre.
 *
 * Via `getPointResolution` rather than `width / widthPx`, because the frame's
 * projection is whatever the user had selected — a UTM zone gives metres
 * directly, but EPSG:4326 would give degrees and EPSG:3857 would give metres
 * inflated by the latitude. This is the number a scale bar or a length
 * readout has to be measured off.
 */
export const metresPerScenePx = (frame: FunnFrame): number => {
  const [minX, minY, maxX, maxY] = frame.extent;
  const unitsPerPx = (maxX - minX) / frame.widthPx;
  return (
    getPointResolution(frame.projection, unitsPerPx, [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
    ]) || unitsPerPx
  );
};
