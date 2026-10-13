import { atom } from 'jotai';
import type Map from 'ol/Map';
import type Interaction from 'ol/interaction/Interaction';

import type { SpotSketch } from '../api/spots';
import type { SketchFrame } from './frame';
import { storableScene, type SceneElement } from './scene';

export type SketchSession = {
  id: number;
  frame: SketchFrame;
  opening: readonly SceneElement[];
};

export const sketchSessionAtom = atom<SketchSession | null>(null);

let sessions = 0;
export const nextSessionId = () => (sessions += 1);

type LiveScene = { frame: SketchFrame; read: () => readonly SceneElement[] };

let live: LiveScene | null = null;

export const setLiveScene = (next: LiveScene | null) => {
  live = next;
};

export const sketchNow = (settled: SpotSketch | null): SpotSketch | null => {
  if (!live) return settled;
  const elements = storableScene(live.read());
  return elements.length > 0 ? { frame: live.frame, elements } : null;
};

let frozen: Interaction[] | null = null;

let mapOrigin = { x: 0, y: 0 };

let sceneToMap = { unit: 1, origin: { x: 0, y: 0 } };

export type SceneView = {
  scrollX: number;
  scrollY: number;
  zoom: number;
  offsetLeft: number;
  offsetTop: number;
};

let worn: { x: number; y: number; scale: number } | null = null;

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

export const slaveMapToScene = (map: Map, view: SceneView | null) => {
  const target = map.getTargetElement();
  if (!target) return;
  if (!view) {
    worn = null;
    target.style.transform = '';
    target.style.transformOrigin = '';
    return;
  }
  if (!frozen) return;
  const scale = view.zoom / sceneToMap.unit;
  const { x, y } = sceneTranslation(view, scale);
  worn = { x, y, scale };
  target.style.transformOrigin = '0 0';
  target.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
};

const HOLD_SLACK = 0.01;

const inRoom = (t: number, room: number) => Math.max(-room, Math.min(0, t));

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

export const initialSceneView = (rect: { left: number; top: number }) => ({
  zoom: sceneToMap.unit,
  scrollX: (mapOrigin.x + sceneToMap.origin.x - rect.left) / sceneToMap.unit,
  scrollY: (mapOrigin.y + sceneToMap.origin.y - rect.top) / sceneToMap.unit,
});

const followTransform = (map: Map) => {
  const size = map.getSize();
  const view = map.getView();
  const resolution = view.getResolution();
  if (!worn || !size || !resolution) return;
  const centre = map.getCoordinateFromPixel([
    (size[0] / 2 - worn.x) / worn.scale,
    (size[1] / 2 - worn.y) / worn.scale,
  ]);
  if (!centre) return;
  view.setResolution(resolution / worn.scale);
  view.setCenter(centre);
  map.renderSync();
};

export const thawMap = (map: Map) => {
  if (!frozen) return;
  const was = frozen;
  frozen = null;
  followTransform(map);
  slaveMapToScene(map, null);
  sceneToMap = { unit: 1, origin: { x: 0, y: 0 } };
  const stillThere = map.getInteractions().getArray();
  was.forEach((interaction) => {
    if (stillThere.includes(interaction)) interaction.setActive(true);
  });
};
