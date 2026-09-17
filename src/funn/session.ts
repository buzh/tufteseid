import type { FeatureCollection } from 'geojson';
import { atom } from 'jotai';
// Type-only, all of them: this module is read from the map's own graph, so
// anything it pulls in at runtime joins the graph the map is built from.
import type Map from 'ol/Map';
import type Interaction from 'ol/interaction/Interaction';
import type { FunnFrame } from './frame';
import type { SceneElement, SketchScene } from './scene';

// One surface, one freeze, two things read off it at the end: `funn` converts
// the strokes to GeoJSON at commit, `sketch` keeps the scene itself as a
// transparent overlay registered to the ground. docs/ui-architecture.md, "Drawing".
export type FunnDrawMode = 'funn' | 'sketch';

/**
 * A stored sketch opened to be changed. The frame it was drawn on comes back
 * with it and becomes the session's: re-registering old strokes to a new
 * viewport would move them off the ground they trace.
 */
export type DrawResume = { id: string; scene: SketchScene };

export type DrawRequest = {
  mode: FunnDrawMode;
  resume?: DrawResume;
  /**
   * Funn mode only: an existing funn's geometry, opened for editing. Unlike a
   * resume it carries no frame, so the surface captures a fresh one and
   * converts the geometry into it (`geometry.ts`).
   */
  seed?: FeatureCollection;
};

// The user asked for the pen; the mode is chosen here, by `Tegn` or `Nytt funn`.
export const drawRequestedAtom = atom<DrawRequest | null>(null);

// An identity for the surface to be keyed on. Every entrance puts the pen down
// and presses it again in one callback, so React never renders the gap and an
// unkeyed canvas keeps the previous session's strokes — which is how a funn's
// shape ends up saved as a sketch.
let sessions = 0;
export const nextSessionId = () => (sessions += 1);

/** The map stopped, and handed to Excalidraw. */
export type FunnSession = {
  /** See `nextSessionId`. */
  id: number;
  mode: FunnDrawMode;
  /** What gives scene coordinates a place on the ground (`frame.ts`). */
  frame: FunnFrame;
  /**
   * What the surface opens on: a resumed sketch's strokes, a funn's geometry
   * converted into the frame, or nothing. Held here rather than derived from
   * `resume`, which a seeded session does not have — it would open blank with
   * the autosave's baseline set to the old geometry, so the first stroke would
   * be written as the whole of the funn.
   */
  opening: readonly SceneElement[];
  /** The record being changed, when this is a resume. */
  resume: { id: string } | null;
};

// Non-null exactly while the surface is up, which is what the rest of the
// chrome reads to stand down. Not interchangeable with `drawRequestedAtom`,
// which is only "the user asked" and can still fail to frame; deciding that
// something else is inop has to read this one.
export const funnSessionAtom = atom<FunnSession | null>(null);

// Elements as Excalidraw hands them over, tombstones and all: stripping is
// `storableScene`'s job at the moment of keeping, because undo has to work
// right up to it.
export const funnSceneAtom = atom<readonly SceneElement[]>([]);

// `funnSceneAtom` lags the pen by a settle (`FunnCanvas`), so anything reading
// the scene in order to *keep* it goes through `sceneNow` instead: `Ferdig` or
// `Behold skissen` pressed on the tail of a stroke would otherwise commit a
// drawing without that stroke, or with nothing in it at all.
let readLiveScene: (() => readonly SceneElement[]) | null = null;

export const setLiveSceneReader = (
  read: (() => readonly SceneElement[]) | null,
) => {
  readLiveScene = read;
};

/** The settled scene, or the live one when a surface is up to ask. */
export const sceneNow = (
  settled: readonly SceneElement[],
): readonly SceneElement[] => readLiveScene?.() ?? settled;

// Every interaction that was live, switched off and remembered. Blunter than
// `map/interactions.ts`'s owner tagging on purpose: nothing at all may move the
// view, including the pan and zoom OpenLayers installs and no owner claimed,
// because the surface is transparent over the real map and a single pan puts
// every stroke in the wrong place. Module-level so the thaw can run from an
// effect cleanup after the component holding it has gone.
let frozen: Interaction[] | null = null;

// Client pixels, read while the map element is still untransformed:
// `slaveMapToScene` needs it and by then would measure the transformed rect.
let mapOrigin: { x: number; y: number } = { x: 0, y: 0 };

// Map pixels per scene unit, and the map pixel the frame's north-west corner
// sits at. Both degenerate for a fresh session; a resumed sketch needs them,
// because flying back to its rectangle is not flying back to its viewport —
// the window has resized and `constrainResolution` snaps to a zoom level. The
// map absorbs that difference so the strokes are neither scaled nor
// re-registered.
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
  // A late frame from a surface already gone would leave a transform on a map
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
  // An easing zoom is not an interaction and survives the loop below, so the
  // extent `captureFunnFrame` is about to read would be a mid-flight one the
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
  frame: FunnFrame,
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
 * Where the scene looks when the surface opens, chosen so the first transform
 * `slaveMapToScene` computes is the identity and nothing slides into place.
 * `rect` is the surface's own position, which Excalidraw uses as scene offset.
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
  const live = map.getInteractions().getArray();
  was.forEach((interaction) => {
    if (live.includes(interaction)) interaction.setActive(true);
  });
};
