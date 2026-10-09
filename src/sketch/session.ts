import { atom } from 'jotai';
// Type-only: a value import would pull OpenLayers into the entry graph.
import type Map from 'ol/Map';
import type Interaction from 'ol/interaction/Interaction';

import type { SpotSketch } from '../api/spots';
import type { SketchFrame } from './frame';
import { storableScene, type SceneElement } from './scene';

/** Non-null exactly while the canvas is up. */
export type SketchSession = {
  id: number;
  frame: SketchFrame;
  opening: readonly SceneElement[];
};

export const sketchSessionAtom = atom<SketchSession | null>(null);

// Keys the canvas: the draw stage can be left and re-entered inside one
// callback, and an unkeyed canvas would keep the old session's view.
let sessions = 0;
export const nextSessionId = () => (sessions += 1);

type LiveScene = { frame: SketchFrame; read: () => readonly SceneElement[] };

// `spotSketchAtom` lags the pen by a settle (`SketchCanvas`), so anything that
// reads the drawing in order to keep it goes through `sketchNow`.
let live: LiveScene | null = null;

export const setLiveScene = (next: LiveScene | null) => {
  live = next;
};

/** The settled drawing, or the live one when a canvas is up to ask. */
export const sketchNow = (settled: SpotSketch | null): SpotSketch | null => {
  if (!live) return settled;
  const elements = storableScene(live.read());
  return elements.length > 0 ? { frame: live.frame, elements } : null;
};

// Every interaction that was active, not just the panning ones: nothing may
// move the view. Module-level so the thaw can run from an effect cleanup.
let frozen: Interaction[] | null = null;

// Client pixels, read while the map element is still untransformed: afterwards
// `getBoundingClientRect` would measure the transformed rect.
let mapOrigin = { x: 0, y: 0 };

// Map pixels per scene unit, and the map pixel the frame's north-west corner
// sits at. Degenerate for a freshly captured frame; for a resumed one the
// transform absorbs what `constrainResolution` and a resized window shifted.
let sceneToMap = { unit: 1, origin: { x: 0, y: 0 } };

/** Where the Excalidraw scene is looking, in its own terms. */
export type SceneView = {
  scrollX: number;
  scrollY: number;
  zoom: number;
  offsetLeft: number;
  offsetTop: number;
};

// Kept so `thawMap` can hand the view what the scene was looking at.
let worn: { x: number; y: number; scale: number } | null = null;

/** Where the transform puts the map element's own top-left, in the element's
 *  own space. */
const sceneTranslation = (view: SceneView, scale: number) => ({
  x:
    view.scrollX * view.zoom +
    view.offsetLeft -
    mapOrigin.x -
    sceneToMap.origin.x * scale,
  y:
    view.scrollY * view.zoom +
    view.offsetTop -
    mapOrigin.y -
    sceneToMap.origin.y * scale,
});

// Excalidraw puts scene point `s` at client `(s + scroll) · zoom + offset`;
// the map, transformed by `translate(t) scale(S)` about its own top-left, puts
// it at `(origin + s · unit) · S + t + mapOrigin`. Equating the two gives
// `S = zoom / unit` and the translation below.
//
// A CSS transform, not a view change: the view must not move or the frame goes
// stale, and the transform is invisible to OpenLayers, whose `getSize()` reads
// layout and whose ResizeObserver watches the content box.
export const slaveMapToScene = (map: Map, view: SceneView | null) => {
  const target = map.getTargetElement();
  if (!target) return;
  if (!view) {
    worn = null;
    target.style.transform = '';
    target.style.transformOrigin = '';
    return;
  }
  // A late frame from a canvas already gone would leave a transform nothing
  // takes off again.
  if (!frozen) return;
  const scale = view.zoom / sceneToMap.unit;
  const { x, y } = sceneTranslation(view, scale);
  worn = { x, y, scale };
  target.style.transformOrigin = '0 0';
  target.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
};

// Under a hundredth of a scene unit a correction is invisible, and writing one
// back could chase float noise frame after frame.
const HOLD_SLACK = 0.01;

// The scaled element is `room` larger than the surface, so the translation may
// run from the far edges meeting to the near ones and no further.
const inRoom = (t: number, room: number) => Math.max(-room, Math.min(0, t));

/** The nearest view to `view` that keeps the frozen map under the whole
 *  surface, or null when `view` already does. At `floorZoom` — the zoom the
 *  canvas opened at — the scaled element covers the surface exactly, so there
 *  is no room to scroll and zooming out would pull ground off the edges;
 *  above it the surplus is that room. */
export const holdSceneOnMap = (
  map: Map,
  view: SceneView,
  floorZoom: number,
): SceneView | null => {
  const size = map.getSize();
  if (!frozen || !size) return null;
  const zoom = Math.max(view.zoom, floorZoom);
  const scale = zoom / sceneToMap.unit;
  const held = { ...view, zoom };
  const t = sceneTranslation(held, scale);
  held.scrollX += (inRoom(t.x, size[0] * (scale - 1)) - t.x) / zoom;
  held.scrollY += (inRoom(t.y, size[1] * (scale - 1)) - t.y) / zoom;
  return zoom !== view.zoom ||
    Math.abs(held.scrollX - view.scrollX) > HOLD_SLACK ||
    Math.abs(held.scrollY - view.scrollY) > HOLD_SLACK
    ? held
    : null;
};

export const freezeMap = (map: Map) => {
  if (frozen) return;
  // An easing zoom is not an interaction and survives the loop below, so
  // `captureFrame` would otherwise read a mid-flight extent.
  map.getView().cancelAnimations();
  const target = map.getTargetElement();
  if (target) {
    const rect = target.getBoundingClientRect();
    mapOrigin = { x: rect.left, y: rect.top };
  }
  sceneToMap = { unit: 1, origin: { x: 0, y: 0 } };
  frozen = map
    .getInteractions()
    .getArray()
    .filter((interaction) => interaction.getActive());
  frozen.forEach((interaction) => interaction.setActive(false));
};

/** Called once, after `freezeMap`. `extentInMap` is the frame's rectangle in
 *  the map's projection. */
export const bindFrameToMap = (
  map: Map,
  frame: SketchFrame,
  extentInMap: [number, number, number, number],
) => {
  const view = map.getView();
  const resolution = view.getResolution();
  const size = map.getSize();
  if (!resolution || !size) return;
  const mapExtent = view.calculateExtent(size);
  sceneToMap = {
    unit: (extentInMap[2] - extentInMap[0]) / frame.widthPx / resolution,
    origin: {
      x: (extentInMap[0] - mapExtent[0]) / resolution,
      y: (mapExtent[3] - extentInMap[3]) / resolution,
    },
  };
};

/** Chosen so the first transform `slaveMapToScene` computes is the identity.
 *  `rect` is the canvas's own position, which Excalidraw uses as the scene
 *  offset. */
export const initialSceneView = (rect: { left: number; top: number }) => ({
  zoom: sceneToMap.unit,
  scrollX: (mapOrigin.x + sceneToMap.origin.x - rect.left) / sceneToMap.unit,
  scrollY: (mapOrigin.y + sceneToMap.origin.y - rect.top) / sceneToMap.unit,
});

// The view takes over what the scene was looking at. The centre is exact;
// `constrainResolution` rounds the scale to a whole zoom level, and the view's
// `maxZoom` caps how far in it can follow.
const followTransform = (map: Map) => {
  const size = map.getSize();
  const view = map.getView();
  const resolution = view.getResolution();
  if (!worn || !size || !resolution) return;
  // Read before the view moves: the transform is inverted against the frame
  // state the frozen view rendered.
  const centre = map.getCoordinateFromPixel([
    (size[0] / 2 - worn.x) / worn.scale,
    (size[1] / 2 - worn.y) / worn.scale,
  ]);
  if (!centre) return;
  view.setResolution(resolution / worn.scale);
  view.setCenter(centre);
  // Before the transform comes off, or the element paints the extent it froze
  // on for a frame.
  map.renderSync();
};

export const thawMap = (map: Map) => {
  if (!frozen) return;
  const was = frozen;
  frozen = null;
  followTransform(map);
  slaveMapToScene(map, null);
  sceneToMap = { unit: 1, origin: { x: 0, y: 0 } };
  // Only the ones still on the map: an interaction removed while the pen was
  // down must not be reactivated off it.
  const stillThere = map.getInteractions().getArray();
  was.forEach((interaction) => {
    if (stillThere.includes(interaction)) interaction.setActive(true);
  });
};
