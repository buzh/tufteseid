import { ProjectionIdentifier } from '../../../projections/types';
import {
  ArcGISImageLayerName,
  BackgroundLayerName,
  EmptyLayerName,
  WMSLayerName,
  WMTSLayerName,
} from '../../backgroundLayers';

// Where a layer actually has data. Set as the layer's `extent` so OL culls
// tiles outside coverage rather than asking the origin to render them — in
// practice mandatory on the fly, to stay under Kartverket's rate limit.
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
  coverageExtent?: CoverageExtent;
};

export type ArcGISImageBackgroundLayer = BackgroundLayerBase & {
  type: 'ArcGISImage';
  layerName: ArcGISImageLayerName;
  // The service root, ending in /ImageServer or /MapServer: OpenLayers appends
  // /exportImage itself and throws "Unknown Rest Service" if it cannot.
  url: string;
  // Merged over TileArcGISRest's upper-case F / FORMAT / TRANSPARENT defaults;
  // a lower-case key adds a second parameter instead of overriding.
  params?: Record<string, string | number | boolean>;
  coverageExtent?: CoverageExtent;
};

export type EmptyBackgroundLayer = BackgroundLayerBase & {
  type: 'Empty';
  layerName: EmptyLayerName;
};

export type BackgroundLayer =
  | WMTSBackgroundLayer
  | WMSBackgroundLayer
  | ArcGISImageBackgroundLayer
  | EmptyBackgroundLayer;
