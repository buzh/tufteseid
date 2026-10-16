import { ProjectionIdentifier } from '../../../projections/types';
import {
  ArcGISImageLayerName,
  BackgroundLayerName,
  EmptyLayerName,
  WMSLayerName,
  WMTSLayerName,
  XYZLayerName,
} from '../../backgroundLayers';

export type CoverageExtent = {
  extent: [number, number, number, number];
  crs: string;
};

export type LayerProvider = {
  capabilitiesUrl: string;
};

type BackgroundLayerBase = {
  layerName: BackgroundLayerName;
  requiredProjection?: ProjectionIdentifier;
  showForProjections?: ProjectionIdentifier[];
  moveToExtent?: [number, number, number, number];
};

export type WMTSBackgroundLayer = BackgroundLayerBase & {
  type: 'WMTS';
  layerName: WMTSLayerName;
  provider: LayerProvider;
};

export type WMSBackgroundLayer = BackgroundLayerBase & {
  type: 'WMS';
  layerName: WMSLayerName;
  url: string;
  props?: Record<string, string | number | boolean>;
  maxZoom?: number;
  interpolate?: boolean;
  coverageExtent?: CoverageExtent;
};

export type ArcGISImageBackgroundLayer = BackgroundLayerBase & {
  type: 'ArcGISImage';
  layerName: ArcGISImageLayerName;
  url: string;
  params?: Record<string, string | number | boolean>;
  maxZoom?: number;
  coverageExtent?: CoverageExtent;
};

export type XYZBackgroundLayer = BackgroundLayerBase & {
  type: 'XYZ';
  layerName: XYZLayerName;
  url: string;
  projection: ProjectionIdentifier;
  minZoom: number;
  maxZoom: number;
  preload: 0 | 2;
  heldUrl?: string;
  interpolate?: boolean;
  coverageExtent?: CoverageExtent;
  coverageMask?: (extent: [number, number, number, number]) => boolean;
};

export type EmptyBackgroundLayer = BackgroundLayerBase & {
  type: 'Empty';
  layerName: EmptyLayerName;
};

export type BackgroundLayer =
  | WMTSBackgroundLayer
  | WMSBackgroundLayer
  | ArcGISImageBackgroundLayer
  | XYZBackgroundLayer
  | EmptyBackgroundLayer;
