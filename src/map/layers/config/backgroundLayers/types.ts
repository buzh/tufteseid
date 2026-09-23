import { ProjectionIdentifier } from '../../../projections/types';
import {
  ArcGISImageLayerName,
  BackgroundLayerName,
  EmptyLayerName,
  WMSLayerName,
  WMTSLayerName,
  XYZLayerName,
} from '../../backgroundLayers';

// Becomes the OL layer's `extent`, so tiles outside coverage are never asked
// for. Declares its own CRS and is transformed to the view's.
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
  /** Absolute z on the view's ladder; defaults to the view's own max (20). */
  maxZoom?: number;
  interpolate?: boolean;
  coverageExtent?: CoverageExtent;
};

export type ArcGISImageBackgroundLayer = BackgroundLayerBase & {
  type: 'ArcGISImage';
  layerName: ArcGISImageLayerName;
  /** Service root ending in /ImageServer or /MapServer; OpenLayers appends
   *  /exportImage itself. */
  url: string;
  /** Merged over TileArcGISRest's upper-case F / FORMAT / TRANSPARENT defaults;
   *  a lower-case key adds a second parameter instead of overriding. */
  params?: Record<string, string | number | boolean>;
  /** Absolute z on the view's ladder; defaults to the view's own max (20). */
  maxZoom?: number;
  coverageExtent?: CoverageExtent;
};

export type XYZBackgroundLayer = BackgroundLayerBase & {
  type: 'XYZ';
  layerName: XYZLayerName;
  /** Template with `{z}`, `{x}` and `{y}`. */
  url: string;
  /** The grid the tiles were written on, whatever the view is set to. */
  projection: ProjectionIdentifier;
  /** Levels the store holds, inclusive; absolute z on that grid, not offsets. */
  minZoom: number;
  maxZoom: number;
  /** Levels either side of the one on screen to fetch ahead; 0 where a miss
   *  costs an upstream render that would hold a tile slot until it finishes. */
  preload: 0 | 2;
  /** The store holds tiles only where there is something to show, so a 404
   *  inside the extent is the coverage mask. Turns off `tileGuard.ts`'s retry:
   *  an `<img>` error carries no status to tell a mask from a failure. */
  sparse: boolean;
  /** A second template over the same tiles with no upstream behind it, read
   *  instead of `url` while this layer's origin is down (`tileGuard.ts`). */
  heldUrl?: string;
  /** Smooth the tile when drawn at anything other than 1:1; OL defaults to
   *  true. False above a layer's deepest level, where the bilinear kernel
   *  clamps at each tile's own edge and seams at every tile boundary. */
  interpolate?: boolean;
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
