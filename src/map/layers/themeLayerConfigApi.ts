import { culturalHeritageConfig } from './config/themeLayers/culturalHeritage';

export interface FieldConfig {
  name: string;
  alias?: string;
  type?: 'symbol' | 'link' | 'picture';
  baseurl?: string;
  filetype?: string;
  unit?: string;
  decimals?: number;
}

export interface ThemeLayerCategory {
  id: string;
  name: {
    nb: string;
    nn: string;
    en: string;
  };
  wmsUrl?: string;
  parentId?: string;
  infoFormat?: string;
  featureInfoImageBaseUrl?: string;
  featureInfoFields?: FieldConfig[];
  extraWmsParams?: Record<string, string | number | boolean>;
  // OpenLayers layer.minZoom — the layer is visible only when the view
  // zoom is strictly greater than this. Cascades to layers in the
  // category unless the layer sets its own.
  minZoom?: number;
}

export interface ThemeLayerDefinition {
  id: string;
  name: {
    nb: string;
    nn: string;
    en: string;
  };
  wmsUrl?: string;
  layers?: string;
  categoryId: string;
  queryable?: boolean;
  styles?: string;
  infoFormat?: string;
  featureInfoImageBaseUrl?: string;
  featureInfoFields?: FieldConfig[];
  extraWmsParams?: Record<string, string | number | boolean>;
  minZoom?: number;
}

export interface ThemeLayerConfig {
  categories: ThemeLayerCategory[];
  layers: ThemeLayerDefinition[];
}

export const themeLayerConfig: ThemeLayerConfig = culturalHeritageConfig;

export const getThemeLayerById = (
  config: ThemeLayerConfig,
  id: string,
): ThemeLayerDefinition | undefined => {
  return config.layers.find((layer) => layer.id === id);
};

export const getCategoryById = (
  config: ThemeLayerConfig,
  categoryId: string,
): ThemeLayerCategory | undefined => {
  return config.categories.find((cat) => cat.id === categoryId);
};

export const getEffectiveWmsUrl = (
  config: ThemeLayerConfig,
  layer: ThemeLayerDefinition,
): string => {
  if (layer.wmsUrl) {
    return layer.wmsUrl;
  }
  const category = getCategoryById(config, layer.categoryId);
  if (category?.wmsUrl) {
    return category.wmsUrl;
  }
  throw new Error(
    `No wmsUrl found for layer ${layer.id} in category ${layer.categoryId}`,
  );
};

export const getParentCategory = (
  config: ThemeLayerConfig,
  category: ThemeLayerCategory,
): ThemeLayerCategory | undefined => {
  if (!category.parentId) {
    return undefined;
  }
  return getCategoryById(config, category.parentId);
};

/**
 * A layer's name in the user's language. Shared by the picker and the figure
 * captions: a saved image lists the overlays that were on it, and the two
 * naming the same layer differently would make a figure hard to reproduce
 * from its own caption.
 */
export const themeLayerName = (id: string, language: string): string => {
  const def = getThemeLayerById(themeLayerConfig, id);
  if (!def) return id;
  const lang = (['nb', 'nn', 'en'] as const).find((l) =>
    language.startsWith(l),
  );
  return def.name[lang ?? 'nb'];
};
