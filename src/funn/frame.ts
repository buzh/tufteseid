import Map from 'ol/Map';
import { getPointResolution, transformExtent } from 'ol/proj';
import type { LocalityBbox } from '../api/localities';

// The one transform between an Excalidraw scene and the ground. Drawing a funn
// freezes the map, so a frame is captured once when the pen goes down and never
// changes while it is down. Scene units are CSS pixels of the frozen viewport,
// origin top-left, y downwards. The extent is in the view projection at freeze,
// not EPSG:4326 like `localities.bbox`: rotation is locked off
// (`map/atoms.ts`), so in a projected CRS the scene↔ground mapping is linear.
export type FunnFrame = {
  /** The map's projection when the pen went down, e.g. 'EPSG:25833'. */
  projection: string;
  /** Ground covered by the frozen viewport, in `projection`. */
  extent: [number, number, number, number];
  /** Scene units across and down — CSS pixels of the frozen viewport. */
  widthPx: number;
  heightPx: number;
};

/** Null before the map has a size. */
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

/** Scene rectangle → ground, EPSG:4326, to compare against `locality.bbox`. */
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
 * Metres one scene unit covers, at the frame's centre. Via `getPointResolution`
 * because the frame's projection is whatever the user had selected: EPSG:4326
 * would give degrees, EPSG:3857 metres inflated by the latitude.
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
