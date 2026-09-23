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

// The B half's layers. Ids carry a `cmp.` prefix and `isBackgroundLayer` is a
// strict `startsWith('bg.')`, so a background swap never sweeps one up. An OL
// layer belongs to one map at a time, so a change of view mode rebuilds the B
// stack in the new host rather than moving it.

// Above the backgrounds (0), below everything the app draws on top of them.
export const COMPARE_Z = 1.5;

const CMP_PREFIX = 'cmp.';

// A fraction of the map width. Module-level, because OL calls the handlers.
let split = 0.5;

const isCompareLayer = (layer: BaseLayer): boolean =>
  String(layer.get('id') ?? '').startsWith(CMP_PREFIX);

const getMainMap = () => getDefaultStore().get(mapAtom);

/** Strips one map of the B half; says whether it was holding any. Retired
 *  rather than dropped, so the other host can take the instances back. */
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

/** Where the B stack draws. Creates the right pane's map when asked for
 *  `split`, so only ask with the mode that is up. Takes the mode rather than
 *  reading it: resolve, build and install span an await and must agree. */
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
// pixels and carries OL's mid-frame transform, non-identity during an animated
// zoom, so a raw clip lands off the CSS divider.
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

// The clip only hides pixels: it runs in `prerender`, after the renderer has
// queued a whole viewport of tiles. The layer `extent` is what saves requests,
// since OL tests it before asking for a tile. It is intersected with the
// layer's own `coverageExtent`, never replacing it, and the original is stashed
// here so unclipping can put it back.
const BASE_EXTENT = 'cmpBaseExtent';

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
    // An empty intersection is correct: OL then draws and fetches nothing.
    const next = curtain
      ? base
        ? getIntersection(base, curtain)
        : curtain
      : base;
    (layer as TileLayer).setExtent(next);
  }
};

// One listener for the whole curtain. Panning moves the revealed strip over new
// ground, so the extents have to be recomputed or B stops filling in.
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

// Flagged so it is idempotent: layers survive installs and the pool with flag,
// stashed extent and handlers on them, so this must run for every incoming
// layer, not only new ones — a second attach clips twice a frame.
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
    // Back to its coverage, or unbounded if it never had one.
    layer.setExtent(layer.get(BASE_EXTENT) as LayerExtent);
    layer.set(BASE_EXTENT, undefined);
  }
};

// Its own variable: the B stack and the background stack swap independently.
let cancelPendingRetire: (() => void) | null = null;

/** Put this stack up as the B half and take down the previous one. `under` and
 * `over` mean what they do in `swapBackgroundLayers`. Every layer takes
 * `COMPARE_Z`, so within B only collection order decides what covers what. */
export const installCompareLayers = (
  under: TileLayer[],
  over: TileLayer[],
  { host, clip }: { host: OlMap; clip: boolean },
) => {
  const collection = host.getLayers();
  const layers = [...under, ...over];
  if (layers.length === 0) return;

  // They are this install's outgoing set anyway; retiring them now would open
  // the gap the deferral avoids.
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

  // After `setClip` has stashed each layer's own extent.
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

export const clearCompareLayers = () => {
  cancelPendingRetire?.();
  trackCurtain(false);
  clearFrom(getMainMap());
  const pane = peekSplitMap();
  if (pane) clearFrom(pane);
};

/**
 * Take the B half off every host but this one. Nothing in the new host retires
 * what the old one is still holding, so this runs before the build, not after.
 */
export const clearCompareLayersExcept = (host: OlMap) => {
  for (const other of [getMainMap(), peekSplitMap()]) {
    if (!other || other === host) continue;
    // Only where something went: the deferred retire belongs to whichever host
    // was installed into last, and cancelling it on a no-op sweep would strand
    // that host's outgoing layers faded on top of the stack.
    if (clearFrom(other)) cancelPendingRetire?.();
  }
};

export const setCurtainSplit = (fraction: number) => {
  split = fraction;
  // Dragging the divider left reveals ground B was never asked for, so the
  // extents follow the handle rather than wait for a `moveend`.
  applyCurtainExtents();
  getMainMap().render();
};
