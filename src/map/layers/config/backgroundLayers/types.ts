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
  /** The deepest level worth asking this service for, absolute z on the view's
   *  ladder. Past a source's own ground sample distance the renderer is
   *  upsampling its own grid, and OL upsampling the last real level says the
   *  same thing without spending four more levels of on-the-fly renders
   *  against a metered origin. Defaults to the view's own max (20), which is
   *  right only for a source that genuinely resolves that far — none here do.
   *  Not part of `layerSignature`: it is fixed per layer, not per dataset. */
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
  /** Whether the store holds tiles only where there is something to show, so a
   *  404 inside the extent is the coverage mask and not a dropped request. True
   *  for ours under /cvat/, false for MapProxy's /cache/, which culls to a
   *  coverage polygon and answers a blank image inside it. It is what turns the
   *  retry in `tileGuard.ts` off: an `<img>` error carries no status, so a mask
   *  would be asked for three times and answer the same thing each time — a
   *  whole screenful of that at a level the store only partly reaches. */
  sparse: boolean;
  /** A second template over the same tiles with no upstream behind it, read
   *  instead of `url` while this layer's origin is down. Only the two national
   *  mosaics have one — see `origins.ts` and `tileGuard.ts`. It does not enter
   *  `layerSignature`: it is derived from `url` and changes no pixels while the
   *  origin is up. */
  heldUrl?: string;
  /** Whether to smooth the tile when it is drawn at anything other than 1:1.
   *  OL's default is true, and above a layer's deepest level that draws a seam:
   *  each tile is resampled on its own and the bilinear kernel clamps at the
   *  tile's own edge, so the last column of one tile and the first of the next
   *  meet as a hard step through a field that is smooth everywhere else. It
   *  measures as a 1.75 grey-level jump against 0.00 either side of it at z19
   *  — one straight line the height of the tile, a couple of pixels wide.
   *  False on the relief layers, which are all capped below the view's own
   *  depth: nearest-neighbour has no kernel to clamp, so there is nothing to
   *  break at the seam, and blocky is the honest picture of a 1 m product read
   *  at z20's 0.021 m/px. True where magnification is the point and the blocks
   *  would cost more than the seam — the ortofoto, the sheets, the labels.
   *  Not part of `layerSignature`: it is fixed per layer, not per dataset. */
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
