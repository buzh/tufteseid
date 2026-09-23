import { ProjectionIdentifier } from '../../../projections/types';
import {
  ArcGISImageLayerName,
  BackgroundLayerName,
  EmptyLayerName,
  WMSLayerName,
  WMTSLayerName,
  XYZLayerName,
} from '../../backgroundLayers';

// Where a layer has data. Set as the layer's `extent` so OL culls tiles
// outside coverage rather than asking the origin to render them.
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
  /** Deepest level worth asking this service for, absolute z on the view's
   *  ladder; defaults to the view's own max (20). Not part of
   *  `layerSignature`: fixed per layer, not per dataset. */
  maxZoom?: number;
  /** As on `XYZBackgroundLayer`. */
  interpolate?: boolean;
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
  /** As on `WMSBackgroundLayer`. */
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
  /** The levels the store holds, inclusive; absolute z on that grid, not an
   *  offset. Outside them nothing is asked for. */
  minZoom: number;
  maxZoom: number;
  /** Levels either side of the one on screen to fetch ahead. 2 for our own
   *  /cvat/ store; 0 for MapProxy's /cache/, where a miss is an upstream
   *  render that would hold a tile slot until it finishes. */
  preload: 0 | 2;
  /** True where the store holds tiles only where there is something to show, so
   *  a 404 inside the extent is the coverage mask. Turns off the retry in
   *  `tileGuard.ts`: an `<img>` error carries no status, so a mask would
   *  otherwise be asked for three times. */
  sparse: boolean;
  /** A second template over the same tiles with no upstream behind it, read
   *  instead of `url` while this layer's origin is down (`tileGuard.ts`). Not
   *  part of `layerSignature`. */
  heldUrl?: string;
  /** Smooth the tile when drawn at anything other than 1:1; OL defaults to
   *  true. False above a layer's deepest level, where the bilinear kernel
   *  clamps at each tile's own edge and draws a seam at every tile boundary.
   *  Not part of `layerSignature`: fixed per layer, not per dataset. */
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
