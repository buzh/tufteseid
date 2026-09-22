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

/** One reading: what every queryable layer answered about one point on the map.
 *  The coordinate is the snapped one that was actually asked about, so a surface
 *  anchors itself where the question was put rather than where the pointer
 *  happened to be. */
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
