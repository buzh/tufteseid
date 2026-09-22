// The map stopped, and handed to Excalidraw.
//
// The canvas is transparent and sits exactly over the map, so a pan while the
// pen is down would put every stroke on the wrong ground. Rather than forbid
// panning, the map is slaved to the canvas: the scene may be scrolled and
// zoomed freely, and the map element follows it with a CSS transform while the
// OpenLayers view holds still. That is what keeps the frame the strokes are
// registered to valid for the whole session.

import { atom } from 'jotai';
// Type-only, both: this module is reachable from the surface that mounts with
// the map, and importing OpenLayers classes for their own sake would pull them
// into that graph for nothing.
import type Map from 'ol/Map';
import type Interaction from 'ol/interaction/Interaction';

import type { SpotSketch } from '../api/spots';
import type { SketchFrame } from './frame';
import { storableScene, type SceneElement } from './scene';

/** Non-null exactly while the canvas is up. */
export type SketchSession = {
  /** See `nextSessionId`. */
  id: number;
  /** What gives scene coordinates a place on the ground (`frame.ts`). */
  frame: SketchFrame;
  /** What the canvas opens on: the draft's strokes so far, or nothing. */
  opening: readonly SceneElement[];
};

export const sketchSessionAtom = atom<SketchSession | null>(null);

// An identity for the canvas to be keyed on. Leaving and re-entering the draw
// stage can happen inside one callback, so React never renders the gap, and an
// unkeyed canvas would keep the previous session's view.
let sessions = 0;
export const nextSessionId = () => (sessions += 1);

// `spotSketchAtom` lags the pen by a settle (`SketchCanvas`), so anything
// reading the drawing in order to *keep* it goes through `sketchNow` instead:
// `Lagre` pressed on the tail of a stroke would otherwise write a drawing
// without that stroke, or with nothing in it at all.
let live: { frame: SketchFrame; read: () => readonly SceneElement[] } | null =
  null;

export const setLiveScene = (
  next: { frame: SketchFrame; read: () => readonly SceneElement[] } | null,
) => {
  live = next;
};

/** The settled drawing, or the live one when a canvas is up to ask. */
export const sketchNow = (settled: SpotSketch | null): SpotSketch | null => {
  if (!live) return settled;
  const elements = storableScene(live.read());
  return elements.length > 0 ? { frame: live.frame, elements } : null;
};

// Every interaction that was live, switched off and remembered. Blunter than
// picking the ones that pan on purpose: nothing at all may move the view,
// including the drag and zoom OpenLayers installs itself, because the canvas is
// transparent over the real map and a single pan puts every stroke in the wrong
// place. Module-level so the thaw can run from an effect cleanup after the
// component holding it has gone.
let frozen: Interaction[] | null = null;

// Client pixels, read while the map element is still untransformed:
// `slaveMapToScene` needs it and by then would measure the transformed rect.
let mapOrigin = { x: 0, y: 0 };

// Map pixels per scene unit, and the map pixel the frame's north-west corner
// sits at. Both degenerate for a frame captured from the viewport it is about
// to freeze; a resumed drawing needs them, because flying back to its rectangle
// is not flying back to its viewport — the window has resized and
// `constrainResolution` snaps to a zoom level. The map absorbs that difference
// so the strokes are neither scaled nor re-registered.
let sceneToMap = { unit: 1, origin: { x: 0, y: 0 } };

/** Where the Excalidraw scene is looking, in its own terms. */
export type SceneView = {
  scrollX: number;
  scrollY: number;
  zoom: number;
  offsetLeft: number;
  offsetTop: number;
};

/*
 * Point the frozen map at whatever the scene is looking at. Excalidraw puts
 * scene point `s` at client `(s + scroll) · zoom + offset`; the map, transformed
 * by `translate(t) scale(S)` about its own top-left, puts it at
 * `(origin + s · unit) · S + t + mapOrigin`. Equating the two gives
 * `S = zoom / unit` and the translation below.
 *
 * A CSS transform and not an OpenLayers view change: the view must not move or
 * the frame the strokes are registered to goes stale under them, and a
 * transform is invisible to OpenLayers — `map.getSize()` reads layout and the
 * ResizeObserver watches the content box, so neither notices. No tile is
 * requested for what is only a magnifying glass over pixels already on screen.
 */
export const slaveMapToScene = (map: Map, view: SceneView | null) => {
  const target = map.getTargetElement();
  if (!target) return;
  if (!view) {
    target.style.transform = '';
    target.style.transformOrigin = '';
    return;
  }
  // A late frame from a canvas already gone would leave a transform on a map
  // nobody is drawing on, and nothing would take it off again.
  if (!frozen) return;
  const scale = view.zoom / sceneToMap.unit;
  const x =
    view.scrollX * view.zoom +
    view.offsetLeft -
    mapOrigin.x -
    sceneToMap.origin.x * scale;
  const y =
    view.scrollY * view.zoom +
    view.offsetTop -
    mapOrigin.y -
    sceneToMap.origin.y * scale;
  target.style.transformOrigin = '0 0';
  target.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
};

export const freezeMap = (map: Map) => {
  if (frozen) return;
  // An easing zoom is not an interaction and would survive the loop below, so
  // the extent `captureFrame` is about to read would be a mid-flight one the
  // map then slides out of.
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

/**
 * Tell the freeze which frame the scene is registered to. Called once, after
 * `freezeMap`. `extentInMap` is that frame's rectangle in the map's projection.
 */
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

/**
 * Where the scene looks when the canvas opens, chosen so the first transform
 * `slaveMapToScene` computes is the identity and nothing slides into place.
 * `rect` is the canvas's own position, which Excalidraw uses as scene offset.
 */
export const initialSceneView = (rect: { left: number; top: number }) => ({
  zoom: sceneToMap.unit,
  scrollX: (mapOrigin.x + sceneToMap.origin.x - rect.left) / sceneToMap.unit,
  scrollY: (mapOrigin.y + sceneToMap.origin.y - rect.top) / sceneToMap.unit,
});

export const thawMap = (map: Map) => {
  if (!frozen) return;
  const was = frozen;
  frozen = null;
  slaveMapToScene(map, null);
  sceneToMap = { unit: 1, origin: { x: 0, y: 0 } };
  // Only the ones still on the map: an interaction removed while the pen was
  // down must not be woken up off the map.
  const stillThere = map.getInteractions().getArray();
  was.forEach((interaction) => {
    if (stillThere.includes(interaction)) interaction.setActive(true);
  });
};
