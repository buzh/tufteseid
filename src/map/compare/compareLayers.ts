import { getDefaultStore } from 'jotai';
import { boundingExtent, getIntersection } from 'ol/extent';
import type BaseLayer from 'ol/layer/Base';
import type TileLayer from 'ol/layer/Tile';
import type OlMap from 'ol/Map';
import { getRenderPixel } from 'ol/render';
import type RenderEvent from 'ol/render/Event';
import { mapAtom } from '../atoms';
import {
  OUTGOING_OPACITY,
  SWAP_TIMEOUT_MS,
} from '../layers/config/backgroundLayers/utils';
import { retireLayer } from '../layers/layerPool';
import type { ViewMode } from './halves';
import { getSplitMap, peekSplitMap } from './splitMap';

// The B half's layers, and where they go. Two hosts, one per two-ground view:
//
// | `curtain` | the main map, clipped to the right of a draggable edge |
// | `split`   | the right pane's own map, whole (`splitMap.ts`)        |
//
// Layer ids carry a `cmp.` prefix and `isBackgroundLayer` is a strict
// `startsWith('bg.')`, so a background swap never sweeps one up; the reuse
// signature is namespaced too, so A and B never share a layer instance. An OL
// layer belongs to one map at a time, so changing view mode rebuilds the B
// stack in the new host rather than moving it.

// Above the background (0), below everything a future UI draws on top of it:
// marks cross the divider rather than being clipped with the ground.
export const COMPARE_Z = 1.5;

const CMP_PREFIX = 'cmp.';

// A fraction of the map width. Module-level, because OL calls the handlers.
let split = 0.5;

const isCompareLayer = (layer: BaseLayer): boolean =>
  String(layer.get('id') ?? '').startsWith(CMP_PREFIX);

const getMainMap = () => getDefaultStore().get(mapAtom);

/** Strips one map of the B half. Says whether it was holding any.
 *
 *  Retired rather than dropped, and this is the pool's best case: a change of
 *  view mode moves the whole B stack between hosts, so what comes off here is
 *  precisely what the other host is about to build. A pooled layer is on no map,
 *  so it can cross. */
const clearFrom = (map: OlMap): boolean => {
  let removed = false;
  for (const layer of map.getLayers().getArray().slice()) {
    if (isCompareLayer(layer)) {
      retireLayer(map, layer);
      removed = true;
    }
  }
  return removed;
};

/** Where the B stack draws in a given view mode. Creates the right pane's map
 *  when asked for `split`, so only ask with the mode that is up. Takes the mode
 *  rather than reading it: the caller resolves the host, builds into it and
 *  installs into it across an await, and a second read could answer
 *  differently — the three have to be one decision. */
export const compareHostFor = (mode: ViewMode): OlMap =>
  mode === 'split' ? getSplitMap() : getMainMap();

// Nothing here is WebGL, so narrow OL's context union once.
const canvas2d = (
  e: RenderEvent,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null => {
  const ctx = e.context;
  return ctx && 'clip' in ctx ? ctx : null;
};

// `getRenderPixel` rather than raw canvas coordinates: the context is in device
// pixels and carries OL's mid-frame transform, which an animated zoom makes
// non-identity, so the clip would land off the CSS divider.
const clipToRightOfSplit = (e: RenderEvent) => {
  const ctx = canvas2d(e);
  if (!ctx) return;
  const size = getMainMap().getSize();
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

// The clip above only hides pixels. It runs in `prerender`, by which point the
// renderer has already worked out which tiles the layer needs for the whole
// viewport and queued every one of them, so on its own the curtain costs a full
// screen of B to show half a screen of it. The layer `extent` is the half that
// actually saves anything: OL tests it before it asks for a tile.
//
// Intersected with whatever the layer was built with, never replacing it — that
// is its `coverageExtent`, and dropping it would put the B stack back to
// ordering renders over open ocean on every zoom out. The original is stashed
// so unclipping can put it back.
const BASE_EXTENT = 'cmpBaseExtent';

// Taken off the method that consumes it rather than imported, so it cannot
// drift from whatever OL's own signature says an extent is.
type LayerExtent = ReturnType<TileLayer['getExtent']>;

// Four corners rather than two: the view can be rotated, and a bounding box off
// the diagonal would cut the revealed strip short.
const curtainExtent = (): LayerExtent => {
  const map = getMainMap();
  const size = map.getSize();
  if (!size) return undefined;
  const [w, h] = size;
  const corners = [
    map.getCoordinateFromPixel([w * split, 0]),
    map.getCoordinateFromPixel([w, 0]),
    map.getCoordinateFromPixel([w, h]),
    map.getCoordinateFromPixel([w * split, h]),
  ];
  // Null before the first render, when there is no frame state to project with.
  if (corners.some((c) => !c)) return undefined;
  return boundingExtent(corners);
};

const applyCurtainExtents = () => {
  const curtain = curtainExtent();
  for (const layer of getMainMap().getLayers().getArray()) {
    if (!isCompareLayer(layer) || !layer.get('cmpClip')) continue;
    const base = layer.get(BASE_EXTENT) as LayerExtent;
    // An empty intersection is the honest answer where a flight's footprint
    // lies entirely left of the divider: OL then draws and fetches nothing.
    const next = curtain
      ? base
        ? getIntersection(base, curtain)
        : curtain
      : base;
    (layer as TileLayer).setExtent(next);
  }
};

// One listener for the whole curtain, not one per layer. Panning moves the
// revealed strip over new ground, so the extent has to be recomputed or B stops
// filling in beyond wherever it was when the curtain went up.
let curtainMoveHandler: (() => void) | null = null;

const trackCurtain = (on: boolean) => {
  const map = getMainMap();
  if (on === Boolean(curtainMoveHandler)) return;
  if (on) {
    curtainMoveHandler = applyCurtainExtents;
    map.on('moveend', curtainMoveHandler);
  } else if (curtainMoveHandler) {
    map.un('moveend', curtainMoveHandler);
    curtainMoveHandler = null;
  }
};

// Both ways, and flagged so it is idempotent: layers survive installs, so a
// second attach would clip twice a frame and a missing detach would carry the
// curtain's geometry into a pane that draws the B ground whole.
//
// They survive the pool as well, flag and stashed extent and handlers with
// them. That is why this is called on every incoming layer rather than only on
// the new ones: a layer that left the curtain and comes back into the split is
// unclipped here, and one that comes back into the curtain is left alone and
// then re-extended by `applyCurtainExtents` below.
const setClip = (layer: TileLayer, on: boolean) => {
  if (Boolean(layer.get('cmpClip')) === on) return;
  layer.set('cmpClip', on);
  if (on) {
    layer.set(BASE_EXTENT, layer.getExtent());
    layer.on('prerender', clipToRightOfSplit);
    layer.on('postrender', unclip);
  } else {
    layer.un('prerender', clipToRightOfSplit);
    layer.un('postrender', unclip);
    // Back to its coverage, or to unbounded if it never had one. A layer that
    // kept a curtain extent into the split pane would draw a vertical slice of
    // itself in a map that has no divider.
    layer.setExtent(layer.get(BASE_EXTENT) as LayerExtent);
    layer.set(BASE_EXTENT, undefined);
  }
};

// Its own variable: the B stack and the background stack swap independently.
let cancelPendingRetire: (() => void) | null = null;

/** Put this stack up as the B half and take down the previous one. `under` and
 * `over` mean what they do in `swapBackgroundLayers` and are what keeps the
 * swap gapless; in the curtain all of these share one zIndex and OL breaks ties
 * by collection order, so where B sits relative to A is COMPARE_Z alone. */
export const installCompareLayers = (
  under: TileLayer[],
  over: TileLayer[],
  { host, clip }: { host: OlMap; clip: boolean },
) => {
  const collection = host.getLayers();
  const layers = [...under, ...over];
  if (layers.length === 0) return;

  // They are this install's outgoing set anyway, and retiring them now would
  // open the gap the deferral avoids.
  cancelPendingRetire?.();

  const outgoing = collection
    .getArray()
    .filter(
      (l) => isCompareLayer(l) && !layers.includes(l as TileLayer),
    ) as TileLayer[];

  under.forEach((layer, i) => {
    setClip(layer, clip);
    layer.setZIndex(COMPARE_Z);
    collection.remove(layer);
    collection.insertAt(i, layer);
  });
  for (const layer of over) {
    setClip(layer, clip);
    layer.setZIndex(COMPARE_Z);
    collection.remove(layer);
    collection.push(layer);
  }

  // After setClip has stashed each layer's own extent, so the intersection has
  // something to intersect with.
  trackCurtain(clip);
  if (clip) applyCurtainExtents();

  for (const layer of outgoing) layer.setOpacity(OUTGOING_OPACITY);

  const retire = () => {
    cancelPendingRetire?.();
    for (const layer of outgoing) retireLayer(host, layer);
  };
  const timer = setTimeout(retire, SWAP_TIMEOUT_MS);
  cancelPendingRetire = () => {
    cancelPendingRetire = null;
    clearTimeout(timer);
    host.un('rendercomplete', retire);
  };
  host.on('rendercomplete', retire);
};

/** Take the B half off both hosts. */
export const clearCompareLayers = () => {
  cancelPendingRetire?.();
  trackCurtain(false);
  clearFrom(getMainMap());
  const pane = peekSplitMap();
  if (pane) clearFrom(pane);
};

/**
 * Take the B half off every host but this one.
 *
 * A change of view mode moves the B stack between maps, and what the map it
 * left is holding belongs to a view nobody is looking at: nothing in the new
 * host will ever retire it. Called by the effect before the build rather than
 * by the install after it, because every way the build can end without
 * installing — an unresolvable stack, a rejected fetch, a generation the reader
 * has already superseded — would otherwise leave the old host drawing.
 */
export const clearCompareLayersExcept = (host: OlMap) => {
  for (const other of [getMainMap(), peekSplitMap()]) {
    if (!other || other === host) continue;
    // Only where something went: the deferred retire belongs to whichever host
    // was installed into last, and cancelling it on a no-op sweep would leave
    // that host's outgoing layers faded on top of the stack for good.
    if (clearFrom(other)) cancelPendingRetire?.();
  }
};

export const setCurtainSplit = (fraction: number) => {
  split = fraction;
  // Dragging the divider left reveals ground B was never asked for, so the
  // extent has to follow the handle rather than wait for a moveend. It only
  // ever requests what is about to be visible, which is still less than the
  // whole viewport the curtain used to fetch up front.
  applyCurtainExtents();
  getMainMap().render();
};
