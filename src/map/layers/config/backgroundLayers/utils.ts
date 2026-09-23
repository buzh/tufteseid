import { getDefaultStore } from 'jotai';
import { WMTSCapabilities } from 'ol/format';
import type BaseLayer from 'ol/layer/Base';
import TileLayer from 'ol/layer/Tile';
import type OlMap from 'ol/Map';
import { transformExtent } from 'ol/proj';
import TileArcGISRest from 'ol/source/TileArcGISRest';
import TileWMS from 'ol/source/TileWMS';
import WMTS, { optionsFromCapabilities } from 'ol/source/WMTS';
import XYZ from 'ol/source/XYZ';
import { fetchWithin } from '../../../../shared/utils/deadline';
import { guardTileSource } from '../../../../upstream/tileGuard';
import { mapAtom } from '../../../atoms';
import { POOL_KEY, retireLayer, takePooledLayer } from '../../layerPool';
import {
  getWMSTileGrid,
  WMS_TILE_CACHE_SIZE,
  WMS_Z_DIRECTION,
} from '../../wmsTileGrid';
import { backgroundLayerCapabilitiesCacheAtom } from './atoms';
import {
  ArcGISImageBackgroundLayer,
  BackgroundLayer,
  CoverageExtent,
  WMSBackgroundLayer,
  WMTSBackgroundLayer,
  XYZBackgroundLayer,
} from './types';

const CAPABILITIES_TIMEOUT_MS = 15000;

export const getWMTSLayer = async (
  layerConfig: WMTSBackgroundLayer,
  projection = 'EPSG:25833',
) => {
  const store = getDefaultStore();

  try {
    const url = layerConfig.provider.capabilitiesUrl;
    const cache = store.get(backgroundLayerCapabilitiesCacheAtom);
    let capabilitiesText: string;
    // Keyed by URL: one document describes every layer a provider publishes.
    if (cache[url]) {
      capabilitiesText = cache[url]!;
    } else {
      capabilitiesText = await fetchWithin(
        url,
        { ms: CAPABILITIES_TIMEOUT_MS, what: `capabilities ${url}` },
        (res) => res.text(),
      );
      store.set(backgroundLayerCapabilitiesCacheAtom, {
        ...cache,
        [url]: capabilitiesText,
      });
    }
    const parser = new WMTSCapabilities();
    const capabilities = parser.read(capabilitiesText);
    const layerOptions = optionsFromCapabilities(capabilities, {
      layer: layerConfig.layerName,
      projection,
    });

    if (!layerOptions) {
      throw new Error(
        `Layer ${layerConfig.layerName} not found in capabilities`,
      );
    }

    // Untainted canvas, so the map can be read back into one;
    // cache.kartverket.no sends ACAO:*.
    const source = new WMTS({ ...layerOptions, crossOrigin: 'anonymous' });
    // The tile URL out of the capabilities, not the capabilities URL: the
    // breaker should not assume they are the same host.
    guardTileSource(source, layerOptions.urls?.[0] ?? url);

    const layer = new TileLayer({
      source,
      properties: { id: `bg.${layerConfig.layerName}` },
      // Pre-rendered and ~130 ms a tile, so preloading coarser levels is cheap.
      preload: 2,
    });

    return layer;
  } catch (error) {
    console.error(
      `Error fetching capabilities for layer ${layerConfig.layerName}:`,
      error,
    );
    return null;
  }
};

// 8 stops per edge, not corners-only: a Norway-sized box out of UTM33 bows.
const toViewExtent = (
  coverage: CoverageExtent | undefined,
  projection: string,
): number[] | undefined => {
  if (!coverage) return undefined;
  if (coverage.crs === projection) return coverage.extent;
  return transformExtent(coverage.extent, coverage.crs, projection, 8);
};

export const getWMSLayer = (layerConfig: WMSBackgroundLayer): TileLayer => {
  const store = getDefaultStore();
  const map = store.get(mapAtom);
  const projection = map.getView().getProjection().getCode();
  const properties = { id: `bg.${layerConfig.layerName}` };

  // No SRS/CRS here: OL derives it from the source projection on every request.
  const source = new TileWMS({
    url: layerConfig.url,
    params: { ...layerConfig.props },
    // Capped at the source's own resolution where it has one: over the cap OL
    // upsamples the deepest real level instead of ordering a render per tile.
    tileGrid: getWMSTileGrid(projection, 0, layerConfig.maxZoom),
    zDirection: WMS_Z_DIRECTION,
    // Undefined is OL's own default, true (`types.ts`).
    interpolate: layerConfig.interpolate,
  });
  guardTileSource(source, layerConfig.url);
  const extent = toViewExtent(layerConfig.coverageExtent, projection);
  // These render on the fly (3-12 s cold) and a preloaded tile holds a tile
  // slot for that long.
  return new TileLayer({
    source,
    properties,
    preload: 0,
    cacheSize: WMS_TILE_CACHE_SIZE,
    ...(extent ? { extent } : {}),
  });
};

export const getArcGISImageLayer = (
  layerConfig: ArcGISImageBackgroundLayer,
): TileLayer => {
  const store = getDefaultStore();
  const map = store.get(mapAtom);
  const projection = map.getView().getProjection().getCode();

  const source = new TileArcGISRest({
    url: layerConfig.url,
    params: { ...layerConfig.params },
    tileGrid: getWMSTileGrid(projection, 0, layerConfig.maxZoom),
    zDirection: WMS_Z_DIRECTION,
    // Off, so a tile is 512x512 at DPI 90 whatever the display; on, SIZE and
    // DPI scale by pixel ratio and wmscache keys the same ground twice.
    hidpi: false,
  });
  guardTileSource(source, layerConfig.url);

  const extent = toViewExtent(layerConfig.coverageExtent, projection);
  return new TileLayer({
    source,
    properties: { id: `bg.${layerConfig.layerName}` },
    preload: 0,
    cacheSize: WMS_TILE_CACHE_SIZE,
    ...(extent ? { extent } : {}),
  });
};

// On the grid the tiles were written on rather than the view's; OL reprojects
// if `?projection=` puts the view elsewhere. Guarded like the rest: the breaker
// half of `guardTileSource` is a no-op for a URL no origin in `src/upstream/`
// claims, and the retry half is what `sparse` turns off (`types.ts`).
export const getXYZLayer = (
  layerConfig: XYZBackgroundLayer,
): TileLayer | null => {
  const store = getDefaultStore();
  const map = store.get(mapAtom);
  const viewProjection = map.getView().getProjection().getCode();

  const tileGrid = getWMSTileGrid(
    layerConfig.projection,
    layerConfig.minZoom,
    layerConfig.maxZoom,
  );
  // The grid carries the store's origin and levels; without it the tiles would
  // be asked for on one nobody wrote them on.
  if (!tileGrid) return null;

  const source = new XYZ({
    url: layerConfig.url,
    projection: layerConfig.projection,
    tileGrid,
    zDirection: WMS_Z_DIRECTION,
    // Undefined is OL's own default, true (`types.ts`).
    interpolate: layerConfig.interpolate,
  });
  guardTileSource(source, layerConfig.url, {
    retry: !layerConfig.sparse,
    heldUrl: layerConfig.heldUrl,
  });

  const extent = toViewExtent(layerConfig.coverageExtent, viewProjection);
  return new TileLayer({
    source,
    properties: { id: `bg.${layerConfig.layerName}` },
    // Hidden one zoom step coarser than the store's own coarsest level; OL
    // would otherwise clamp there and ask for four screenfuls to upscale.
    maxResolution: tileGrid.getResolution(layerConfig.minZoom) * 2,
    preload: layerConfig.preload,
    cacheSize: WMS_TILE_CACHE_SIZE,
    ...(extent ? { extent } : {}),
  });
};

export const getLayerFromConfig = async (
  layerConfig: BackgroundLayer,
  projection?: string,
): Promise<TileLayer | null> => {
  if (layerConfig.type === 'WMTS') {
    return await getWMTSLayer(layerConfig, projection);
  }
  if (layerConfig.type === 'WMS') {
    return getWMSLayer(layerConfig);
  }
  if (layerConfig.type === 'ArcGISImage') {
    return getArcGISImageLayer(layerConfig);
  }
  if (layerConfig.type === 'XYZ') {
    return getXYZLayer(layerConfig);
  }
  console.warn(`Unsupported layer type for layerconfig: ${layerConfig}`);
  return null;
};

// `bg.` is swept by `swapBackgroundLayers`; `cmp.`, the curtain's B side, must
// stay invisible to that sweep. It also namespaces the reuse signature: A and B
// often resolve to one config and cannot share an instance.
export type LayerNamespace = 'bg' | 'cmp';

const isBackgroundLayer = (layer: BaseLayer): boolean =>
  String(layer.get('id') ?? '').startsWith('bg.');

// Equal signatures mean equal pixels.
const layerSignature = (
  config: BackgroundLayer,
  projection: string,
): string | null => {
  if (config.type === 'WMTS') return `wmts|${config.layerName}|${projection}`;
  if (config.type === 'WMS') {
    return `wms|${config.url}|${JSON.stringify(config.props)}|${projection}`;
  }
  if (config.type === 'ArcGISImage') {
    const params = JSON.stringify(config.params);
    return `arcgis|${config.url}|${params}|${projection}`;
  }
  // Levels and extent join the url: they fence which of the store's tiles are
  // ever asked for, where the url alone only names the store.
  if (config.type === 'XYZ') {
    const extent = JSON.stringify(config.coverageExtent);
    const levels = `${config.minZoom}-${config.maxZoom}`;
    return `xyz|${config.url}|${levels}|${extent}|${projection}`;
  }
  return null;
};

// Reuses a layer that would render identically, so callers must set opacity
// and z-index explicitly: it may carry an earlier swap's. `host` is which map
// to search and defaults to the main one; an OL layer belongs to one map at a
// time, so the split view's right pane must search its own collection. The pool
// behind it (`layerPool.ts`) has no such restriction — nothing there is on a
// map.
export const buildOrReuseBackgroundLayer = async (
  config: BackgroundLayer,
  projection: string,
  ns: LayerNamespace = 'bg',
  host?: OlMap,
): Promise<TileLayer | null> => {
  const store = getDefaultStore();
  const map = host ?? store.get(mapAtom);
  const base = layerSignature(config, projection);
  const signature = base && `${ns}|${base}`;
  if (signature) {
    const existing = map
      .getLayers()
      .getArray()
      .find((l) => l.get(POOL_KEY) === signature);
    if (existing) return existing as TileLayer;
    const pooled = takePooledLayer(signature);
    if (pooled) return pooled;
  }
  const layer = await getLayerFromConfig(config, projection);
  if (layer) {
    // The builders all stamp `bg.<name>`; anything else renames on the way out.
    if (ns !== 'bg') layer.set('id', `${ns}.${config.layerName}`);
    if (signature) layer.set(POOL_KEY, signature);
  }
  return layer;
};

// How long the outgoing stack waits for a render that never comes; a cold
// LiDAR tile takes 3-12 s.
export const SWAP_TIMEOUT_MS = 15000;

export const OUTGOING_OPACITY = 0.35;

let cancelPendingRetire: (() => void) | null = null;

// Both lists are bottom-first, over outgoing layers that go on rendercomplete.
export const swapBackgroundLayers = (under: TileLayer[], over: TileLayer[]) => {
  const store = getDefaultStore();
  const map = store.get(mapAtom);
  const layers = [...under, ...over];
  if (layers.length === 0) return;

  // Cancelled rather than run: those layers are in this swap's outgoing set.
  cancelPendingRetire?.();

  const collection = map.getLayers();
  const outgoing = collection
    .getArray()
    .filter((l) => isBackgroundLayer(l) && !layers.includes(l as TileLayer));

  // Reposition rather than add: reused layers are already in the collection.
  under.forEach((layer, i) => {
    collection.remove(layer);
    collection.insertAt(i, layer);
  });
  for (const layer of over) {
    collection.remove(layer);
    collection.push(layer);
  }

  for (const layer of outgoing) layer.setOpacity(OUTGOING_OPACITY);

  const retire = () => {
    cancelPendingRetire?.();
    for (const layer of outgoing) retireLayer(map, layer);
  };
  const timer = setTimeout(retire, SWAP_TIMEOUT_MS);
  cancelPendingRetire = () => {
    cancelPendingRetire = null;
    clearTimeout(timer);
    map.un('rendercomplete', retire);
  };
  map.on('rendercomplete', retire);
};

export const clearBackgroundLayer = () => {
  const store = getDefaultStore();
  const map = store.get(mapAtom);
  // Nothing is coming in to hide behind, so a deferred removal happens now.
  cancelPendingRetire?.();
  // Snapshot: getArray() is live, and removing while iterating skips entries.
  const allLayers = [...map.getLayers().getArray()];
  allLayers.forEach((layer) => {
    try {
      if (isBackgroundLayer(layer)) {
        retireLayer(map, layer);
      }
    } catch (error) {
      console.error('Error while clearing background layers:', error);
    }
  });
};
