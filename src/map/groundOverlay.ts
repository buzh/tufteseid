// The georeferenced images over the background — a stack, not a slot.
//
// This started as terrainOverlayLayer.ts, which existed so a terrain render
// could be read *against* everything else on the map — the Kulturminner
// layers, a lokalitet's rectangle, the funn drawn on it — instead of being
// letterboxed into a thumbnail. A kept bilde wants exactly the same thing and
// for exactly the same reason (docs/lokalitet-view.md §4.2): the owner's 1937
// ortofoto faded over the reader's live hillshade, in register, with the funn
// on top, is the thing the app is for.
//
// So both are "an image of this rectangle" at `zIndex: 1` — and for a while
// there was **one slot** they took turns holding, arbitrated here, with the
// displaced side told to drop its own selection. That was wrong about the one
// comparison the sentence above promises: a 1937 ortofoto *over* today's
// hillshade is two images of one rectangle, and the arbiter's whole job was
// making sure there was never more than one. §13 is the correction, and this
// module is the mechanism half of it: the members are **declared**, they stack
// bottom-to-top in whatever order the layer row gives them, and each carries
// its own opacity.
//
// **One layer and one canvas for the whole group**, not one per member. The
// members are an ordered composite with per-member alpha, which is precisely
// what a draw loop over one canvas is; and the output canvas is
// viewport-sized (30 MB on a 4K display at devicePixelRatio 2), so one per
// member would make a composition of eight cost a quarter of a gigabyte
// before a single source pixel. Drawing in order also makes the stack's
// z-order the list's order for free, with no fractional zIndex ladder to
// maintain.
//
// **Producers declare, the row orders.** A contributor puts its pixels up
// under a key of its own choosing and knows nothing about the rest of the
// stack; `setGroundOverlayStack` is where the bottom-to-top order and the
// row's own switches arrive, from one caller. That split is not a preference
// either — the producers live in different trees (Terrenganalyse's state is
// mounted once from RibbonGlobalRow, a View's from the lokalitet workspace),
// so there is no component above all of them to declare the array the way
// `sketchOverlay.ts` does. Step 5 is where the row became that caller and the
// fixed two-value key gave way to its order, as step 1 said it would.
//
// Imperative and module-level, like `swapBackgroundLayers`, rather than an
// atom plus a hook. The two things that change here — the pixels on every
// slider frame, the opacity on every drag of its own — change dozens of times
// a second and no React component needs to see either. Routing them through
// jotai would re-render the whole shell at that rate for nothing. The *control*
// state below is the other half of that sentence and is atoms, because it is
// pressed a handful of times a session and four surfaces read it.

import { atom, getDefaultStore } from 'jotai';
import type { Extent } from 'ol/extent';
import ImageLayer from 'ol/layer/Image';
import type { Size } from 'ol/size';
import ImageCanvasSource from 'ol/source/ImageCanvas';
import { mapAtom } from './atoms';

const LAYER_ID = 'ground.overlay';

// Over the background stack, which sets no zIndex at all (i.e. 0), and under
// everything drawn on top of it: the sketches (2), the lokalitet rectangles
// (4), the funn (5) and the theme layers (10). Putting the heritage record on
// top of the relief is the whole point, so the relief has to be the ground.
//
// The compare curtain's B half is at 1.5 and therefore covers this whole
// group, which is unchanged from when the group was a single image and is
// still what the curtain is for: the B half is another *full* ground, and
// what it is dragged over is everything the A side has composed.
const Z_INDEX = 1;

/**
 * The live terrain render — Terrenganalyse's own key, and [Visning]'s bottom
 * member when Terreng is the ground on screen (docs/lokalitet-view.md §13.1).
 *
 * Named here rather than spelled at both ends because the row has to hold this
 * one down without being able to withdraw it: the render is declared by
 * `useTerrainAnalysis` in row 1, and the switch for it is [Visning]'s preset
 * member, three components away.
 */
export const TERRAIN_KEY = 'terrain';

/** One View in [Visning]'s pulldown, by attachment id. */
export const viewKeyOf = (attachmentId: string) => `view:${attachmentId}`;

export type GroundOverlayMember = {
  /**
   * What to paint. Terrain hands over *the same canvas* it paints into and
   * nothing is copied, so repaints land in place and the source has no way of
   * noticing its cached image went stale — which is why `setGroundOverlay` is
   * also the repaint call. A bilde hands over a decoded `<img>`.
   */
  source: HTMLCanvasElement | HTMLImageElement;
  /**
   * The part of `source` that is ground, in its own pixels. The whole canvas
   * for a terrain render; for a bilde, `meta.imageRect` scaled to whichever
   * rendition actually loaded — a figure PNG carries its caption panel below
   * the image, so the file is not pixel-registered to the extent.
   */
  crop: { x: number; y: number; width: number; height: number };
  /** EPSG:25833. The ground `crop` covers, edge to edge. */
  extent25833: [number, number, number, number];
};

let layer: ImageLayer<ImageCanvasSource> | null = null;

const members = new Map<string, GroundOverlayMember>();

// Remembered per contributor and deliberately outliving the member: switching
// DTM→DOM withdraws the terrain image and declares a new one, and losing the
// fade you had just dialled in on the way through would be a bug. Never
// pruned, and that is the same decision said once more — a key that is gone
// costs one number, and forgetting it is the bug above with a longer fuse.
const opacityByKey = new Map<string, number>();

// The row's half of the arrangement: which keys are its members, bottom to
// top, and which of those it is holding down.
//
// Held is not the same as withdrawn, and only the row needs the difference.
// A member's own switch withdraws it — the producer unmounts and the pixels
// go — but the group label and the ground preset have to take down members
// that somebody else declared, and have to give them back unchanged. So they
// are skipped in the draw loop and nothing else about them moves.
//
// Keys the row has not named paint *above* everything it has, in the order
// they were declared. That is where `usePinnedBilde` sits until step 6 gives
// [Bilde] a declaration of its own, and it is the right place for it: a File
// on the ground is the group above this one.
let order: readonly string[] = [];
let held: ReadonlySet<string> = new Set<string>();

const stack = (): string[] => {
  const named = order.filter((key) => members.has(key));
  const rest = [...members.keys()].filter((key) => !order.includes(key));
  return [...named, ...rest];
};

// One output canvas for the group's whole life rather than one per call.
// ImageCanvasSource explicitly supports a reused element — that is what
// `changed()` is for — and the alternative is allocating a viewport-sized
// canvas on every frame of a slider drag.
let out: HTMLCanvasElement | null = null;

const drawFrame = (
  extent: Extent,
  resolution: number,
  pixelRatio: number,
  size: Size,
): HTMLCanvasElement => {
  out ??= document.createElement('canvas');
  const width = Math.round(size[0]);
  const height = Math.round(size[1]);
  if (out.width !== width || out.height !== height) {
    out.width = width;
    out.height = height;
  }
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  ctx.clearRect(0, 0, width, height);

  // Ground metres → canvas pixels.
  const scale = pixelRatio / resolution;
  for (const key of stack()) {
    if (held.has(key)) continue;
    const member = members.get(key);
    if (!member) continue;
    const alpha = opacityByKey.get(key) ?? 1;
    if (!(alpha > 0)) continue;
    const [minX, minY, maxX, maxY] = member.extent25833;
    const w = (maxX - minX) * scale;
    const h = (maxY - minY) * scale;
    const { x, y, width: cw, height: ch } = member.crop;
    if (cw <= 0 || ch <= 0) continue;
    ctx.globalAlpha = alpha;
    // Nearest-neighbour once a source pixel is larger than a screen pixel:
    // smoothing on upscale blurs away precisely the single-pixel step — a
    // ditch edge, the lip of a mound — that the image exists to show. On
    // downscale it is the other way round and averaging helps. Per member,
    // because two members of one stack can be at very different resolutions.
    ctx.imageSmoothingEnabled = w < cw;
    ctx.drawImage(
      member.source,
      x,
      y,
      cw,
      ch,
      (minX - extent[0]) * scale,
      (extent[3] - maxY) * scale,
      w,
      h,
    );
  }
  ctx.globalAlpha = 1;
  return out;
};

const redraw = () => {
  const map = getDefaultStore().get(mapAtom);
  if (members.size === 0) {
    if (layer) map.removeLayer(layer);
    layer = null;
    out = null;
    return;
  }
  if (!layer) {
    layer = new ImageLayer({
      source: new ImageCanvasSource({
        // Fixed, so a view in any of the app's other projections gets the
        // image reprojected rather than placed wrong.
        projection: 'EPSG:25833',
        canvasFunction: drawFrame,
      }),
      zIndex: Z_INDEX,
      properties: { id: LAYER_ID },
    });
    map.addLayer(layer);
    return;
  }
  layer.getSource()?.changed();
};

/**
 * Put this contributor's image up, move it to a new rectangle, announce that
 * its pixels changed under us, or — with `null` — take it down. All of them
 * are the same call, because the source caches one image and `changed()` is
 * the only way to invalidate it. Building the layer once and re-asking it for
 * its image is also what keeps re-framing and every slider frame from
 * flashing.
 *
 * Withdrawing is unconditional: a contributor owns its own key and nothing
 * else's, so there is no "but somebody else has the slot" case left to guard
 * against. That guard, and the `subscribeGroundOverlay` that told the
 * displaced side to drop its selection, are what §13 deleted.
 */
export const setGroundOverlay = (
  key: string,
  member: GroundOverlayMember | null,
) => {
  if (member) members.set(key, member);
  else if (!members.delete(key)) return;
  redraw();
};

/** 0..1. Fades this member towards whatever is under it in the stack. */
export const setGroundOverlayOpacity = (key: string, value: number) => {
  if (opacityByKey.get(key) === value) return;
  opacityByKey.set(key, value);
  if (members.has(key)) redraw();
};

const sameOrder = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((key, i) => key === b[i]);

const sameHeld = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((key) => b.has(key));

/**
 * The layer row's statement about this group: its members bottom to top, and
 * which of them it is holding down.
 *
 * One caller — `VisningControl` — and it re-declares the whole thing on every
 * change rather than adding and removing, for the reason `setSketchOverlays`
 * does: switching a member, switching the group, reordering the exhibit and
 * closing the lokalitet are four routes to the same map and only one of them
 * is a removal. Cheap to call redundantly; the compare below is what makes
 * that true.
 */
export const setGroundOverlayStack = (
  keys: readonly string[],
  hidden: ReadonlySet<string>,
) => {
  if (sameOrder(order, keys) && sameHeld(held, hidden)) return;
  order = keys;
  held = hidden;
  redraw();
};

/*
 * [Visning]'s control state — the row's, not the map's.
 *
 * Here rather than in `localities/atoms.ts` for the reason the sketch group's
 * three live in `map/sketchOverlay.ts`: an atom that only makes sense against
 * one mechanism belongs beside it. Nothing here is persisted (§13.10's third
 * trap) and `useLocalityWorkspace` empties all four when the lokalitet closes
 * or swaps.
 */

/**
 * The bottom member: whether there is a ground at all.
 *
 * Not a fifth ground mode and not a background of its own — it takes the
 * background stack down (`setBackgroundHidden`) and holds `TERRAIN_KEY` when
 * Terreng is what is up. §13.1's second consequence, and the one reading where
 * "off" means something for this group: a sketch and its funn on white, with
 * nothing underneath arguing.
 */
export const groundShownAtom = atom(true);

/**
 * Which Views are on the ground, by attachment id. **Empty by default**, and
 * that is load-bearing: switching one on can start a WMS stitch, so a
 * lokalitet that put every extract up on open would spend a minute of
 * Kartverket's rate limit answering a question nobody asked.
 */
export const visningShownAtom = atom<ReadonlySet<string>>(new Set<string>());

/** How far each shown View is faded, 0–100 by attachment id. Missing is 100. */
export const visningOpacityAtom = atom<ReadonlyMap<string, number>>(
  new Map<string, number>(),
);

/** The group label's flag — see `sketchGroupShownAtom` for why it is its own. */
export const visningGroupShownAtom = atom(true);
