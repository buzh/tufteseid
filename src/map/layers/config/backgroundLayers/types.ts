import { ProjectionIdentifier } from '../../../projections/types';
import {
  ArcGISImageLayerName,
  BackgroundLayerName,
  EmptyLayerName,
  WMSLayerName,
  WMTSLayerName,
  XYZLayerName,
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

// A tile store addressed by {z}/{x}/{y} rather than a service asked to render:
// no capabilities, no params, and only the levels somebody wrote.
export type XYZBackgroundLayer = BackgroundLayerBase & {
  type: 'XYZ';
  layerName: XYZLayerName;
  /** Template with `{z}`, `{x}` and `{y}`. */
  url: string;
  /** The grid the tiles were written on, whatever the view is set to. */
  projection: ProjectionIdentifier;
  /** The levels the store holds, inclusive; outside them nothing is asked for.
   *  Absolute z on that grid, not an offset. */
  minZoom: number;
  maxZoom: number;
  /** How many levels either side of the one on screen to fetch ahead. 2 for a
   *  store that is only ever read — ours, under /cvat/ — where the tile comes
   *  back in milliseconds and the prefetch takes the blank out of a zoom step.
   *  0 for MapProxy's /cache/, where a miss is an upstream render: a preloaded
   *  tile would hold a tile slot for as long as that takes, which is the same
   *  reason the WMS layers preload 0. */
  preload: 0 | 2;
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
  | XYZBackgroundLayer
  | EmptyBackgroundLayer;
