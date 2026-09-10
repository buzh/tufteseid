import { ProjectionIdentifier } from '../../../projections/types';
import {
  ArcGISImageLayerName,
  BackgroundLayerName,
  EmptyLayerName,
  WMSLayerName,
  WMTSLayerName,
} from '../../backgroundLayers';

export type LayerType = 'WMTS' | 'WMS' | 'ArcGISImage' | 'Empty';

// Where a layer actually has data. Transformed to the view projection and
// set as the layer's `extent`, so OL culls tiles outside coverage instead
// of asking the origin to render them. Mandatory in practice for anything
// that renders on the fly — see docs/wms-proxy-and-tiles.md.
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
  // The service root, ending in /ImageServer or /MapServer. OpenLayers
  // appends /exportImage (or /export) itself and throws "Unknown Rest
  // Service" if it can't, so this must not already carry the operation.
  url: string;
  // Merged over TileArcGISRest's own F / FORMAT / TRANSPARENT defaults,
  // which it writes in upper case — a lower-case key here adds a second
  // parameter instead of overriding.
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
