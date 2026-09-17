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

// The B half of the compare curtain, on the map. Curtain layer ids carry a
// `cmp.` prefix and `isBackgroundLayer` is a strict `startsWith('bg.')`, so a
// background swap never sweeps one up; the reuse signature is namespaced too,
// so A and B never share a layer instance.

// Above the background (0) and the ground overlay (1), below the sketches (2),
// measure (3), the rectangles (4) and funn (5) — marks cross the divider.
export const COMPARE_Z = 1.5;

const CMP_PREFIX = 'cmp.';

// A fraction of the map width. Module-level, because OL calls the handlers.
let split = 0.5;

const isCompareLayer = (layer: BaseLayer): boolean =>
  String(layer.get('id') ?? '').startsWith(CMP_PREFIX);

const getMap = () => getDefaultStore().get(mapAtom);

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
 * swap gapless; all of these share one zIndex and OL breaks ties by collection
 * order, so where B sits relative to A is COMPARE_Z alone. */
export const installCompareLayers = (under: TileLayer[], over: TileLayer[]) => {
  const map = getMap();
  const collection = map.getLayers();
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
  cancelPendingRetire?.();
  for (const layer of map.getLayers().getArray().slice()) {
    if (isCompareLayer(layer)) map.removeLayer(layer);
  }
};

export const setCurtainSplit = (fraction: number) => {
  split = fraction;
  getMap().render();
};
