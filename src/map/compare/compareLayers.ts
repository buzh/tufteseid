import { getDefaultStore } from 'jotai';
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
import { viewModeAtom } from './halves';
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

const clearFrom = (map: OlMap) => {
  for (const layer of map.getLayers().getArray().slice()) {
    if (isCompareLayer(layer)) map.removeLayer(layer);
  }
};

/** Where the B stack draws in the view mode that is up. Creates the right
 *  pane's map when asked for it, so only call it once split is the mode. */
export const compareHost = (): OlMap =>
  getDefaultStore().get(viewModeAtom) === 'split'
    ? getSplitMap()
    : getMainMap();

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

const attachClip = (layer: TileLayer) => {
  // Layers survive installs, and a second pair would clip twice a frame.
  if (layer.get('cmpClip')) return;
  layer.set('cmpClip', true);
  layer.on('prerender', clipToRightOfSplit);
  layer.on('postrender', unclip);
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

  // Anything the other host is still holding belongs to a view mode that is no
  // longer up, and nothing will ever retire it from there.
  for (const other of [getMainMap(), peekSplitMap()]) {
    if (!other || other === host) continue;
    clearFrom(other);
  }

  const outgoing = collection
    .getArray()
    .filter(
      (l) => isCompareLayer(l) && !layers.includes(l as TileLayer),
    ) as TileLayer[];

  under.forEach((layer, i) => {
    if (clip) attachClip(layer);
    layer.setZIndex(COMPARE_Z);
    collection.remove(layer);
    collection.insertAt(i, layer);
  });
  for (const layer of over) {
    if (clip) attachClip(layer);
    layer.setZIndex(COMPARE_Z);
    collection.remove(layer);
    collection.push(layer);
  }

  for (const layer of outgoing) layer.setOpacity(OUTGOING_OPACITY);

  const retire = () => {
    cancelPendingRetire?.();
    for (const layer of outgoing) host.removeLayer(layer);
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
  clearFrom(getMainMap());
  const pane = peekSplitMap();
  if (pane) clearFrom(pane);
};

export const setCurtainSplit = (fraction: number) => {
  split = fraction;
  getMainMap().render();
};
