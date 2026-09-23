import type { FieldConfig } from '../layers/themeLayerConfigApi';

export interface FeatureProperties {
  [key: string]: string | number | boolean | null;
}

export interface FeatureInfoFeature {
  id?: string;
  properties: FeatureProperties;
}

export interface LayerFeatureInfo {
  layerId: string;
  layerTitle: string;
  features: FeatureInfoFeature[];
  error?: string;
  imageBaseUrl?: string;
  fieldConfigs?: FieldConfig[];
}

/** What every queryable layer answered about one point. `coordinate` is the
 *  snapped one that was asked about, not the pointer's own. */
export interface FeatureInfoReading {
  coordinate: [number, number];
  layers: LayerFeatureInfo[];
}

export type InfoFormat =
  | 'application/json'
  | 'application/vnd.ogc.gml'
  | 'application/vnd.ogc.gml/3.1.1'
  | 'text/xml'
  | 'text/xml; subtype=gml/3.1.1'
  | 'text/plain'
  | 'text/html';

export const DEFAULT_INFO_FORMAT: InfoFormat = 'application/json';
