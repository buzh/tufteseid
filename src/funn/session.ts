import type { FeatureCollection } from 'geojson';
import { atom } from 'jotai';
// Type-only, all of them: this module is read from the map's own graph, so
// anything it pulls in at runtime joins the graph the map is built from.
import type Map from 'ol/Map';
import type Interaction from 'ol/interaction/Interaction';
import type { FunnFrame } from './frame';
import type { SceneElement, SketchScene } from './scene';

/*
 * One pen, two things it makes — docs/ui-architecture.md §9.
 *
 * In `funn` mode the strokes are converted to GeoJSON at commit and become a
 * funn's geometry; in `sketch` mode the scene itself is kept, as a transparent
 * overlay registered to the ground. The surface is the same surface and the
 * freeze is the same freeze; what differs is what is read off it at the end,
 * which is why this is a mode rather than two components.
 */
export type FunnDrawMode = 'funn' | 'sketch';

/**
 * Resuming a drawing that already exists — a stored sketch, opened to be
 * changed. The scene comes back with the frame it was drawn on, and that frame
 * is the session's: re-registering old strokes to a new viewport is the one
 * thing that would move them off the ground they trace.
 */
export type DrawResume = { id: string; scene: SketchScene };

export type DrawRequest = {
  mode: FunnDrawMode;
  resume?: DrawResume;
  /**
   * Funn mode only: an existing funn's geometry, opened for editing
   * ("Rediger tegningen"). Unlike a resume this carries no frame — there was
   * never a scene, only the record — so the surface captures a fresh one and
   * converts the geometry into it (`geometry.ts`).
   */
  seed?: FeatureCollection;
};

/*
 * The pen, pressed.
 *
 * Its own atom rather than a reading of `funnDraftActiveAtom`, and it carries
 * the mode because pressing the pen is where the mode is chosen: `Tegn` asks
 * for a sketch, `Nytt funn` asks for a funn, and nothing downstream should
 * have to reconstruct which.
 */
export const drawRequestedAtom = atom<DrawRequest | null>(null);

/** The map stopped, and handed to Excalidraw. */
export type FunnSession = {
  mode: FunnDrawMode;
  /** What gives scene coordinates a place on the ground (`frame.ts`). */
  frame: FunnFrame;
  /**
   * What the surface opens on, whichever way in it came: a resumed sketch's
   * own strokes, a funn's geometry converted into the frame, or nothing at
   * all for a blank session. Held here rather than derived from `resume`
   * because a seeded session has no resume and would otherwise open blank —
   * with the autosave's baseline set to the old geometry, so the first stroke
   * would be the whole of the funn.
   */
  opening: readonly SceneElement[];
  /** The record being changed, when this is a resume. */
  resume: { id: string } | null;
};

/*
 * A drawing session.
 *
 * Non-null exactly while the surface is up, which is what the rest of the
 * chrome reads to stand down — the ribbon's global row goes inert, the left
 * and right slots get out of the way.
 *
 * Note the asymmetry with `drawRequestedAtom`: the pen going down is a request,
 * and it fails if the map has no size to frame. `drawRequestedAtom` is "the
 * user asked"; this is "the map is frozen and the surface is live". Only the
 * second one may be used to decide that something else is inop.
 */
export const funnSessionAtom = atom<FunnSession | null>(null);

/*
 * What is currently drawn.
 *
 * The scene used to be discarded at every pointer-up — `onChange` read the
 * appState and threw the elements away — so pressing the pen twice gave a
 * blank canvas and `Lagre` had nothing to save. This is the fix, and it is an
 * atom rather than a ref because two surfaces outside the canvas read it: the
 * autosave that turns a funn's strokes into geometry (§8.5), and the draft row
 * that offers to keep a sketch.
 *
 * Elements as Excalidraw hands them over, tombstones and all. Stripping is
 * `storableScene`'s job and happens at the moment of keeping, because undo has
 * to keep working right up to it.
 */
export const funnSceneAtom = atom<readonly SceneElement[]>([]);

/*
 * The freeze itself.
 *
 * Every interaction that was live goes inactive and is remembered, rather
 * than the map being rebuilt or the viewport covered: the drawing surface is
 * transparent over the real map and has to stay in register with it, so a
 * single pan would put every stroke in the wrong place.
 *
 * Blunter than `map/interactions.ts`'s owner tagging on purpose. That registry
 * exists so one feature can remove its own interactions without disturbing
 * another's; this has the opposite requirement — *nothing* may move the view,
 * including the pan and zoom OpenLayers installs by default, which no owner
 * ever claimed.
 *
 * Module-level rather than an atom because it is not state anybody renders,
 * and because the thaw has to be able to run from an effect cleanup after the
 * component holding it has gone.
 */
let frozen: Interaction[] | null = null;

/*
 * Where the map element's top-left sat when the view stopped, in client
 * pixels, read once while it is still untransformed — `slaveMapToScene` needs
 * it and cannot measure it afterwards, since by then the rectangle it would
 * measure is the transformed one.
 */
let mapOrigin: { x: number; y: number } = { x: 0, y: 0 };

/*
 * How the frozen map's own pixels relate to the scene's.
 *
 * `unit` is how many map pixels one scene unit is, and `origin` is the map
 * pixel the frame's north-west corner sits at. For a session that framed the
 * view it is looking at, both are trivial — one, and the top-left corner — and
 * that was the only case the first version of this handled.
 *
 * A **resumed** sketch is the case that needs them. Its scene is registered to
 * the frame it was drawn on, and the map is flown back to that rectangle
 * before the freeze, but "back to that rectangle" is not "back to that
 * viewport": the window has been resized, a ribbon row has come or gone, and
 * `constrainResolution` snaps the view to a zoom level rather than to whatever
 * resolution the drawing was made at. Scaling the strokes to fit would be
 * lossy and re-registering them would be wrong, so the *map* absorbs the
 * difference instead, which is the same trick that lets Excalidraw's own zoom
 * work without moving the view.
 */
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
 * Point the frozen map at whatever the scene is looking at.
 *
 * The drawing surface is transparent: what is under a stroke is the real map,
 * not a photograph of it, so the two have to move together or the stroke is
 * over ground nobody traced. Excalidraw puts scene point `s` at client
 * `(s + scroll) · zoom + offset`; the map, transformed by `translate(t)
 * scale(S)` about its own top-left, puts scene point `s` at client
 * `(origin + s · unit) · S + t + mapOrigin`. Equating the two gives
 * `S = zoom / unit` and the translation below.
 *
 * A CSS transform rather than an OpenLayers view change, and that is the whole
 * point of doing it this way: the view does not move, so `frame.ts` stays
 * valid, no tile is requested, and nothing is asked of Kartverket for a zoom
 * that is only ever a magnifying glass over pixels already on screen. The
 * blur when magnified is the same blur a photograph would have given.
 *
 * A transform is also invisible to OpenLayers, which is what makes it safe:
 * `map.getSize()` reads layout, and the ResizeObserver behind it watches the
 * content box, so neither notices. Move the view instead and the frame the
 * strokes are registered to would go stale under them.
 *
 * Imperative and module-level like `map/groundOverlay.ts`: this runs on every
 * wheel notch and no React component needs to see it.
 */
export const slaveMapToScene = (map: Map, view: SceneView | null) => {
  const target = map.getTargetElement();
  if (!target) return;
  if (!view) {
    target.style.transform = '';
    target.style.transformOrigin = '';
    return;
  }
  // A late frame from a surface that has already gone would put a transform
  // on a map nobody is drawing on, and nothing would take it off again.
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
  // extent `captureFunnFrame` is about to read would be a mid-flight one that
  // the map then slides out of. Cancelling leaves the view wherever the
  // animation had got to, which is a real place and the one on screen.
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
 * Tell the freeze which frame the scene is registered to.
 *
 * Called once, after `freezeMap`, with the frame the session will use — the
 * one just captured, or a resumed sketch's own. Everything it computes is
 * degenerate in the first case, which is why there is one code path.
 *
 * `extentInMap` is the frame's rectangle expressed in the map's projection;
 * the caller does the transform because it is the one that knows whether one
 * is needed.
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
 * Where the scene should be looking when the surface opens.
 *
 * Chosen so the transform `slaveMapToScene` computes on the first change is
 * the identity: the map is not moved or scaled at all, and a resumed sketch
 * appears exactly over the ground it was traced on with nothing sliding into
 * place afterwards. `rect` is the surface's own position, which is what
 * Excalidraw uses as its scene offset.
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
  // Only the ones still on the map. An interaction removed while the pen was
  // down — the measure tool's, say — must not be woken up off the map.
  const live = map.getInteractions().getArray();
  was.forEach((interaction) => {
    if (live.includes(interaction)) interaction.setActive(true);
  });
};
