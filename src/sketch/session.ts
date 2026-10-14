import { atom } from 'jotai';
import type Map from 'ol/Map';
import type Interaction from 'ol/interaction/Interaction';

import type { SpotSketch } from '../api/spots';
import { PEN_HOLDS_MAP, rememberMapView } from '../map/atoms';
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

let bound: { minX: number; maxY: number; unitsPerPx: number } | null = null;

export const moveMapToScene = (map: Map, view: SceneView) => {
  const size = map.getSize();
  if (!frozen || !bound || !size) return;
  const resolution = bound.unitsPerPx / view.zoom;
  if (!(resolution > 0)) return;
  const mapView = map.getView();
  mapView.setResolution(resolution);
  mapView.setCenter([
    bound.minX -
      view.scrollX * bound.unitsPerPx -
      (view.offsetLeft - mapOrigin.x - size[0] / 2) * resolution,
    bound.maxY +
      view.scrollY * bound.unitsPerPx +
      (view.offsetTop - mapOrigin.y - size[1] / 2) * resolution,
  ]);
  map.renderSync();
};

const SESSION_MAX_ZOOM = 26;

let released: { maxZoom: number; constrained: boolean } | null = null;

export const freezeMap = (map: Map) => {
  if (frozen) return;
  const view = map.getView();
  view.cancelAnimations();
  const target = map.getTargetElement();
  if (target) {
    const rect = target.getBoundingClientRect();
    mapOrigin = { x: rect.left, y: rect.top };
  }
  sceneToMap = { unit: 1, origin: { x: 0, y: 0 } };
  released = {
    maxZoom: view.getMaxZoom(),
    constrained: view.getConstrainResolution(),
  };
  map.set(PEN_HOLDS_MAP, true);
  view.setMaxZoom(SESSION_MAX_ZOOM);
  view.setConstrainResolution(false);
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
  const unitsPerPx = (extentInMap[2] - extentInMap[0]) / frame.widthPx;
  bound = { minX: extentInMap[0], maxY: extentInMap[3], unitsPerPx };
  sceneToMap = {
    unit: unitsPerPx / resolution,
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

export const thawMap = (map: Map) => {
  if (!frozen) return;
  const was = frozen;
  frozen = null;
  bound = null;
  const view = map.getView();
  if (released) {
    view.setMaxZoom(released.maxZoom);
    view.setConstrainResolution(released.constrained);
    released = null;
  }
  map.set(PEN_HOLDS_MAP, false);
  rememberMapView(map);
  sceneToMap = { unit: 1, origin: { x: 0, y: 0 } };
  const stillThere = map.getInteractions().getArray();
  was.forEach((interaction) => {
    if (stillThere.includes(interaction)) interaction.setActive(true);
  });
};
