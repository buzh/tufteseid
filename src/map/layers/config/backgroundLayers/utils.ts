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

    const source = new WMTS({ ...layerOptions, crossOrigin: 'anonymous' });

    guardTileSource(source, layerOptions.urls?.[0] ?? url);

    const layer = new TileLayer({
      source,
      properties: { id: `bg.${layerConfig.layerName}` },

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

  const source = new TileWMS({
    url: layerConfig.url,
    params: { ...layerConfig.props },
    tileGrid: getWMSTileGrid(projection, 0, layerConfig.maxZoom),
    zDirection: WMS_Z_DIRECTION,
    interpolate: layerConfig.interpolate,
  });
  guardTileSource(source, layerConfig.url);
  const extent = toViewExtent(layerConfig.coverageExtent, projection);

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
  if (!tileGrid) return null;

  const source = new XYZ({
    url: layerConfig.url,
    projection: layerConfig.projection,
    tileGrid,
    zDirection: WMS_Z_DIRECTION,
    interpolate: layerConfig.interpolate,
  });
  const mask = layerConfig.coverageMask;
  if (mask) {
    const template = source.getTileUrlFunction();

    source.setTileUrlFunction((coord, pixelRatio, projection) =>
      mask(
        tileGrid.getTileCoordExtent(coord) as [number, number, number, number],
      )
        ? template(coord, pixelRatio, projection)
        : undefined,
    );
  }

  guardTileSource(source, layerConfig.url, {
    retry: !layerConfig.sparse,
    heldUrl: layerConfig.heldUrl,
  });

  const extent = toViewExtent(layerConfig.coverageExtent, viewProjection);
  return new TileLayer({
    source,
    properties: { id: `bg.${layerConfig.layerName}` },

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

export type LayerNamespace = 'bg' | 'cmp';

const isBackgroundLayer = (layer: BaseLayer): boolean =>
  String(layer.get('id') ?? '').startsWith('bg.');

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

  if (config.type === 'XYZ') {
    const extent = JSON.stringify(config.coverageExtent);
    const levels = `${config.minZoom}-${config.maxZoom}`;
    return `xyz|${config.url}|${levels}|${extent}|${projection}`;
  }
  return null;
};

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

    if (ns !== 'bg') layer.set('id', `${ns}.${config.layerName}`);
    if (signature) layer.set(POOL_KEY, signature);
  }
  return layer;
};

export const SWAP_TIMEOUT_MS = 15000;

export const OUTGOING_OPACITY = 0.35;

let cancelPendingRetire: (() => void) | null = null;

export const swapBackgroundLayers = (under: TileLayer[], over: TileLayer[]) => {
  const store = getDefaultStore();
  const map = store.get(mapAtom);
  const layers = [...under, ...over];
  if (layers.length === 0) return;

  cancelPendingRetire?.();

  const collection = map.getLayers();
  const outgoing = collection
    .getArray()
    .filter((l) => isBackgroundLayer(l) && !layers.includes(l as TileLayer));

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
  cancelPendingRetire?.();

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
