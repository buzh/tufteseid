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
// module is the mechanism half of it: the members are **declared**, they
// stack bottom-to-top in `ORDER`, and each carries its own opacity.
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
// Contributors declare themselves by key rather than one caller declaring the
// whole array, which is the difference between this and `sketchOverlay.ts`.
// That is not a preference: the two live in different trees — Terrenganalyse's
// state is mounted once from RibbonGlobalRow, a bilde's from the lokalitet
// workspace — and inventing a shared owner for them now would be building the
// layer row's state before the layer row. When that row lands it becomes the
// single caller and the key gives way to the row's own order.
//
// Imperative and module-level, like `swapBackgroundLayers`, rather than an
// atom plus a hook. The two things that change here — the pixels on every
// slider frame, the opacity on every drag of its own — change dozens of times
// a second and no React component needs to see either. Routing them through
// jotai would re-render the whole shell at that rate for nothing.

import { getDefaultStore } from 'jotai';
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
 * Who is contributing an image, and — read as an array — in what order they
 * stack. Terrenganalyse's live render is a reading of the ground itself, so
 * it sits at the bottom; a kept bilde is laid over it.
 */
export type GroundOverlayKey = 'terrain' | 'bilde';

const ORDER: readonly GroundOverlayKey[] = ['terrain', 'bilde'];

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

const members = new Map<GroundOverlayKey, GroundOverlayMember>();

// Remembered per contributor and deliberately outliving the member: switching
// DTM→DOM withdraws the terrain image and declares a new one, and losing the
// fade you had just dialled in on the way through would be a bug.
const opacityByKey: Record<GroundOverlayKey, number> = {
  terrain: 1,
  bilde: 1,
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
  for (const key of ORDER) {
    const member = members.get(key);
    if (!member) continue;
    const alpha = opacityByKey[key];
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
  key: GroundOverlayKey,
  member: GroundOverlayMember | null,
) => {
  if (member) members.set(key, member);
  else if (!members.delete(key)) return;
  redraw();
};

/** 0..1. Fades this member towards whatever is under it in the stack. */
export const setGroundOverlayOpacity = (
  key: GroundOverlayKey,
  value: number,
) => {
  if (opacityByKey[key] === value) return;
  opacityByKey[key] = value;
  if (members.has(key)) redraw();
};
