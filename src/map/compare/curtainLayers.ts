import { getDefaultStore } from 'jotai';
import type BaseLayer from 'ol/layer/Base';
import type TileLayer from 'ol/layer/Tile';
import { getRenderPixel } from 'ol/render';
import type RenderEvent from 'ol/render/Event';
import { mapAtom } from '../atoms';
import {
  OUTGOING_OPACITY,
  SWAP_TIMEOUT_MS,
} from '../layers/config/backgroundLayers/utils';

/*
 * The B half of the compare curtain, on the map.
 *
 * Imperative and module-level, like swapBackgroundLayers and the terrain
 * overlay: the clip rectangle moves with every pointer frame of a drag and
 * no React component needs to see that.
 *
 * Two things keep this out of the ordinary background machinery's way. The
 * layer ids carry a `cmp.` prefix, and `isBackgroundLayer` is a strict
 * `startsWith('bg.')`, so a background swap never sweeps a curtain layer up
 * as collateral. And the reuse signature is namespaced too, so A and B never
 * end up handed the same layer instance — which would put it in the map
 * twice and clip the half that isn't B's.
 */

// Above the background stack (0) and the terrain render (1) — Terreng on the
// left against a photograph on the right is one of the comparisons worth
// making — and below everything drawn on top of the ground: the draw layer
// (2), measure (3), the lokalitet rectangles (4), funn (5). Marks have to
// stay drawn across the divider; a funn that disappears when you drag the
// curtain over it is exactly the thing you opened compare to look at.
//
// Fractional like funnHighlightLayer's 4.5, for the same reason: the ladder
// is a fixed set of integers and this belongs between two of them.
export const COMPARE_Z = 1.5;

const CMP_PREFIX = 'cmp.';

// Where the curtain edge is, as a fraction of the map's width from the left.
// Read inside the render handlers rather than passed in: OL calls them, not
// us.
let split = 0.5;

const isCompareLayer = (layer: BaseLayer): boolean =>
  String(layer.get('id') ?? '').startsWith(CMP_PREFIX);

const getMap = () => getDefaultStore().get(mapAtom);

// `getRenderPixel` rather than raw canvas coordinates: the context handed to
// a render handler is in device pixels and carries whatever transform OL is
// mid-frame with (during an animated zoom that is not identity). Translating
// the four corners through it is the only way the clip lands where the CSS
// divider is.
// OL types `RenderEvent.context` as the union of every renderer's context,
// WebGL included. Nothing here uses a WebGL layer class, so the map is always
// Canvas-rendered — but the compiler only sees the union, so narrow it once
// with an `in` check rather than casting at every call below.
const canvas2d = (
  e: RenderEvent,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null => {
  const ctx = e.context;
  return ctx && 'clip' in ctx ? ctx : null;
};

const clipToRightOfSplit = (e: RenderEvent) => {
  const ctx = canvas2d(e);
  if (!ctx) return;
  const size = getMap().getSize();
  if (!size) return;
  const [w, h] = size;
  const x = w * split;
  const tl = getRenderPixel(e, [x, 0]);
  const tr = getRenderPixel(e, [w, 0]);
  const br = getRenderPixel(e, [w, h]);
  const bl = getRenderPixel(e, [x, h]);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(tl[0], tl[1]);
  ctx.lineTo(tr[0], tr[1]);
  ctx.lineTo(br[0], br[1]);
  ctx.lineTo(bl[0], bl[1]);
  ctx.closePath();
  ctx.clip();
};

const unclip = (e: RenderEvent) => canvas2d(e)?.restore();

const attachClip = (layer: TileLayer) => {
  // Layers survive across installs when the resolved stack is unchanged, and
  // a second pair of handlers would save/clip/restore twice per frame.
  if (layer.get('cmpClip')) return;
  layer.set('cmpClip', true);
  layer.on('prerender', clipToRightOfSplit);
  layer.on('postrender', unclip);
};

// Cancels the pending retirement of the previous B swap, if any. Its own
// variable rather than the background stack's: the two swap independently
// and either may be mid-retirement while the other starts.
let cancelPendingRetire: (() => void) | null = null;

/**
 * Put this stack on the map as the B half and take down whatever the
 * previous B half was.
 *
 * Both lists are bottom-first and mean what they mean in
 * `swapBackgroundLayers`: `under` goes below the outgoing layers (the topo
 * base, the faded national mosaic — context the layer on its way out should
 * keep covering), `over` above them. The split is what makes the swap
 * gapless. Pushing the whole incoming stack on top would put its *topo base*
 * over the outgoing dataset, so changing B's acquisition would flash plain
 * topo through the curtain while the new tiles loaded — which is exactly the
 * comparison the user was in the middle of making.
 *
 * All of them share one zIndex; OL breaks ties by collection order, so the
 * positions below are the order they draw in. Where they sit relative to the
 * A half is settled by zIndex alone (COMPARE_Z against its default 0), which
 * is why `under` may go to the bottom of the collection without ending up
 * beneath the background stack.
 */
export const installCompareLayers = (under: TileLayer[], over: TileLayer[]) => {
  const map = getMap();
  const collection = map.getLayers();
  const layers = [...under, ...over];
  if (layers.length === 0) return;

  // An install arriving while an earlier one is still retiring: cancel that
  // retirement rather than run it, for the same reason as the background
  // swap — those layers are this install's outgoing set anyway.
  cancelPendingRetire?.();

  const outgoing = collection
    .getArray()
    .filter(
      (l) => isCompareLayer(l) && !layers.includes(l as TileLayer),
    ) as TileLayer[];

  under.forEach((layer, i) => {
    attachClip(layer);
    layer.setZIndex(COMPARE_Z);
    collection.remove(layer);
    collection.insertAt(i, layer);
  });
  for (const layer of over) {
    attachClip(layer);
    layer.setZIndex(COMPARE_Z);
    collection.remove(layer);
    collection.push(layer);
  }

  for (const layer of outgoing) layer.setOpacity(OUTGOING_OPACITY);

  const retire = () => {
    cancelPendingRetire?.();
    for (const layer of outgoing) map.removeLayer(layer);
  };
  const timer = setTimeout(retire, SWAP_TIMEOUT_MS);
  cancelPendingRetire = () => {
    cancelPendingRetire = null;
    clearTimeout(timer);
    map.un('rendercomplete', retire);
  };
  map.on('rendercomplete', retire);
};

export const clearCompareLayers = () => {
  const map = getMap();
  // Nothing is coming in to hide behind, so a deferred removal should just
  // happen now.
  cancelPendingRetire?.();
  for (const layer of map.getLayers().getArray().slice()) {
    if (isCompareLayer(layer)) map.removeLayer(layer);
  }
};

/** Move the curtain edge. Cheap enough to call on every pointer frame. */
export const setCurtainSplit = (fraction: number) => {
  split = fraction;
  getMap().render();
};
