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

const COMPARE_Z = 1.5;

const CMP_PREFIX = 'cmp.';

let split = 0.5;

const isCompareLayer = (layer: BaseLayer): boolean =>
  String(layer.get('id') ?? '').startsWith(CMP_PREFIX);

const getMainMap = () => getDefaultStore().get(mapAtom);

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

export const compareHostFor = (mode: ViewMode): OlMap =>
  mode === 'split' ? getSplitMap() : getMainMap();

const canvas2d = (
  e: RenderEvent,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null => {
  const ctx = e.context;
  return ctx && 'clip' in ctx ? ctx : null;
};

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

const BASE_EXTENT = 'cmpBaseExtent';

type LayerExtent = ReturnType<TileLayer['getExtent']>;

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
  if (corners.some((c) => !c)) return undefined;
  return boundingExtent(corners);
};

const applyCurtainExtents = () => {
  const curtain = curtainExtent();
  for (const layer of getMainMap().getLayers().getArray()) {
    if (!isCompareLayer(layer) || !layer.get('cmpClip')) continue;
    const base = layer.get(BASE_EXTENT) as LayerExtent;
    const next = curtain
      ? base
        ? getIntersection(base, curtain)
        : curtain
      : base;
    (layer as TileLayer).setExtent(next);
  }
};

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
    layer.setExtent(layer.get(BASE_EXTENT) as LayerExtent);
    layer.set(BASE_EXTENT, undefined);
  }
};

let cancelPendingRetire: (() => void) | null = null;

export const installCompareLayers = (
  under: TileLayer[],
  over: TileLayer[],
  { host, clip }: { host: OlMap; clip: boolean },
) => {
  const collection = host.getLayers();
  const layers = [...under, ...over];
  if (layers.length === 0) return;

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

export const clearCompareLayersExcept = (host: OlMap) => {
  for (const other of [getMainMap(), peekSplitMap()]) {
    if (!other || other === host) continue;
    if (clearFrom(other)) cancelPendingRetire?.();
  }
};

export const setCurtainSplit = (fraction: number) => {
  split = fraction;
  applyCurtainExtents();
  getMainMap().render();
};
