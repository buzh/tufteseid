import { atom } from 'jotai';
// Type-only, both of them: `drawEnabledAtom` reads this module, so anything
// it pulls in at runtime joins the graph the map is built from.
import type Map from 'ol/Map';
import type Interaction from 'ol/interaction/Interaction';
import type { FunnFrame } from './frame';

/*
 * The pen, pressed.
 *
 * Its own flag rather than a reading of `funnDraftActiveAtom`: the Excalidraw
 * surface and the OpenLayers draw subsystem are two ways to draw the same
 * thing, and until the first has replaced the second they are kept apart so
 * that neither is holding the other's state. `Tegn` sets this;
 * `Nytt funn` does not.
 */
export const drawRequestedAtom = atom(false);

/*
 * A drawing session: the map stopped, and handed to Excalidraw.
 *
 * Non-null exactly while the surface is up, which is what the rest of the
 * chrome reads to stand down — the ribbon's global row goes inert, the left
 * and right slots get out of the way. Inside it is the frame that gives scene
 * coordinates a place on the ground (`frame.ts`).
 *
 * Note the asymmetry with `drawRequestedAtom`: the pen going down is a request,
 * and it fails if the map has no size to frame. `drawRequestedAtom` is "the
 * user asked"; this is "the map is frozen and the surface is live". Only the
 * second one may be used to decide that something else is inop.
 */
export const funnSessionAtom = atom<FunnFrame | null>(null);

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
 * `(s + scroll) · zoom + offset`; the map, untransformed, puts its own pixel
 * `s` at client `s + mapOrigin`, because scene units *are* map pixels
 * (`frame.ts`). Equating the two gives the translation below.
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
  const x = view.scrollX * view.zoom + view.offsetLeft - mapOrigin.x;
  const y = view.scrollY * view.zoom + view.offsetTop - mapOrigin.y;
  target.style.transformOrigin = '0 0';
  target.style.transform = `translate(${x}px, ${y}px) scale(${view.zoom})`;
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
  frozen = map
    .getInteractions()
    .getArray()
    .filter((interaction) => interaction.getActive());
  frozen.forEach((interaction) => interaction.setActive(false));
};

export const thawMap = (map: Map) => {
  if (!frozen) return;
  const was = frozen;
  frozen = null;
  slaveMapToScene(map, null);
  // Only the ones still on the map. An interaction removed while the pen was
  // down — the measure tool's, say — must not be woken up off the map.
  const live = map.getInteractions().getArray();
  was.forEach((interaction) => {
    if (live.includes(interaction)) interaction.setActive(true);
  });
};
