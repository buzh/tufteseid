import TileLayer from 'ol/layer/Tile';
import { TileWMS } from 'ol/source';
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

/** `overrides` pins LAYERS/STYLES at construction: kulturminner2's settings can
 *  differ from the config defaults on the first frame, and correcting
 *  afterwards costs a screenful of GetMap at RA's MapServer. */
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

  return new TileLayer({
    source: new TileWMS({
      url: wmsUrl,
      params: { ...wmsParams, TILED: true },
      projection: projection,
      // The same 512 px grid as the WMS backgrounds: RA's MapServer is the
      // slowest origin, and there are half as many seams to clip a label.
      tileGrid: getWMSTileGrid(projection),
      zDirection: WMS_Z_DIRECTION,
    }),
    properties: layerProperties,
    cacheSize: WMS_TILE_CACHE_SIZE,
    // preload 0 as on the WMS backgrounds: on-the-fly renders sharing the one
    // tile queue, so coarse levels are not worth a slot.
    preload: 0,
    ...(minZoom !== undefined ? { minZoom } : {}),
  });
};
