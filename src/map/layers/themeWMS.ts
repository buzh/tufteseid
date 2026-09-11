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

// Fork keeps only Kulturminner theme layers.
export type ThemeLayerName =
  | 'heritageSites'
  | 'culturalEnvironments'
  | 'sefrakBuildings'
  | 'protectedBuildings'
  | 'userReportedHeritage';

/**
 * `overrides` lets a caller pin LAYERS/STYLES at construction time. Only
 * Kulturminner uses it, and only because the sublayer and render settings can
 * already differ from the config's defaults on the first frame: building the
 * layer from the config and correcting it afterwards would spend a screenful
 * of GetMap requests, at RA's MapServer, on a picture nobody asked for.
 */
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

  // No SRS/CRS: OL writes it from the source projection on every request
  // (ol/source/wms.js). Setting it here just adds a parameter the server
  // ignores.
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
      // 512 px, same grid the WMS background layers use — see
      // src/map/layers/wmsTileGrid.ts. RA's MapServer is the slowest
      // origin in the stack, so quartering the request count per
      // screenful helps most here; it also halves the number of tile
      // seams a point symbol or label can be clipped by.
      tileGrid: getWMSTileGrid(projection),
      zDirection: WMS_Z_DIRECTION,
    }),
    properties: layerProperties,
    cacheSize: WMS_TILE_CACHE_SIZE,
    // preload 0 for the same reason as the WMS background layers: these
    // are on-the-fly renders (RA's MapServer especially) sharing the
    // map's one tile queue with the base map, and coarse levels nobody
    // asked for are not worth a slot. See "One tile queue per Map" in
    // docs/wms-proxy-and-tiles.md.
    preload: 0,
    ...(minZoom !== undefined ? { minZoom } : {}),
  });
};
