import TileLayer from 'ol/layer/Tile';
import { TileWMS } from 'ol/source';
import { guardTileSource } from '../../upstream/tileGuard';
import { POOL_KEY } from './layerPool';
import type {
  ThemeLayerConfig,
  ThemeLayerDefinition,
} from './themeLayerConfigApi';
import {
  getCategoryById,
  getEffectiveWmsUrl,
  getParentCategory,
} from './themeLayerConfigApi';
import {
  getWMSTileGrid,
  WMS_TILE_CACHE_SIZE,
  WMS_Z_DIRECTION,
} from './wmsTileGrid';

export type ThemeLayerName =
  | 'heritageSites'
  | 'culturalEnvironments'
  | 'sefrakBuildings'
  | 'protectedBuildings'
  | 'userReportedHeritage';

// LAYERS and STYLES are excluded: `updateParams` changes them on a live layer.
export const themeLayerPoolKey = (layerId: string, projection: string) =>
  `theme|${layerId}|${projection}`;

// `overrides` pins LAYERS/STYLES at construction; correcting them afterwards
// costs a screenful of GetMap.
export const createThemeLayerFromConfig = (
  config: ThemeLayerConfig,
  layerDef: ThemeLayerDefinition,
  projection: string,
  overrides?: { LAYERS: string; STYLES: string },
): TileLayer | null => {
  if (!layerDef.layers) {
    console.warn(`Layer ${layerDef.id} has no WMS layers defined`);
    return null;
  }

  const wmsUrl = getEffectiveWmsUrl(config, layerDef);

  const category = getCategoryById(config, layerDef.categoryId);
  const parentCategory = category
    ? getParentCategory(config, category)
    : undefined;
  const infoFormat =
    layerDef.infoFormat || category?.infoFormat || parentCategory?.infoFormat;
  const featureInfoImageBaseUrl =
    layerDef.featureInfoImageBaseUrl ||
    category?.featureInfoImageBaseUrl ||
    parentCategory?.featureInfoImageBaseUrl;
  const featureInfoFields =
    layerDef.featureInfoFields ||
    category?.featureInfoFields ||
    parentCategory?.featureInfoFields;

  const layerProperties = {
    id: `theme.${layerDef.id}`,
    [POOL_KEY]: themeLayerPoolKey(layerDef.id, projection),
    queryable: layerDef.queryable ?? false,
    layerTitle: layerDef.name.nb || layerDef.id,
    ...(infoFormat ? { infoFormat } : {}),
    ...(featureInfoImageBaseUrl ? { featureInfoImageBaseUrl } : {}),
    ...(featureInfoFields ? { featureInfoFields } : {}),
  };

  const extraWmsParams = {
    ...parentCategory?.extraWmsParams,
    ...category?.extraWmsParams,
    ...layerDef.extraWmsParams,
  };

  const minZoom =
    layerDef.minZoom ?? category?.minZoom ?? parentCategory?.minZoom;

  // No SRS/CRS: OL writes it from the source projection on every request.
  const wmsParams = {
    LAYERS: layerDef.layers,
    TRANSPARENT: true,
    STYLES: layerDef.styles ?? '',
    ...extraWmsParams,
    ...overrides,
  };

  const source = new TileWMS({
    url: wmsUrl,
    params: { ...wmsParams, TILED: true },
    projection: projection,
    tileGrid: getWMSTileGrid(projection),
    zDirection: WMS_Z_DIRECTION,
  });
  guardTileSource(source, wmsUrl);

  return new TileLayer({
    source,
    properties: layerProperties,
    cacheSize: WMS_TILE_CACHE_SIZE,
    // On-the-fly renders share one tile queue.
    preload: 0,
    ...(minZoom !== undefined ? { minZoom } : {}),
  });
};
