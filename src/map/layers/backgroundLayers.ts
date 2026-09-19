export type WMSLayerName =
  | 'lidarHillshade'
  // Amtskart is a WMS, not WMTS: the historical maps are not in the tile cache.
  | 'amtskart'
  // Project and style come from activeLidarProjectAtom, not a static config.
  | 'lidarProject'
  // Norge i bilder's seamless best-available ortofoto mosaic.
  | 'flyfoto'
  // Hybrid's transparent overlay: stacked on a background, never a choice.
  | 'topoOverlay';

// One ortofoto acquisition, not a WMS: /wms/ortofoto publishes only the merged
// mosaic and /wms/ortofoto_prosjekter 403s, so this is an ArcGIS ImageServer.
export type ArcGISImageLayerName = 'flyfotoProject';

// Our own cached ground: a plain tile store on disk, not a service.
export type XYZLayerName = 'lidarCvat';

export type EmptyLayerName = 'empty';

// Each name is the WMTS identifier Kartverket's cache is asked for.
export type WMTSLayerName =
  'topo' | 'topograatone' | 'toporaster' | 'sjokartraster';

export type BackgroundLayerName =
  | WMTSLayerName
  | WMSLayerName
  | ArcGISImageLayerName
  | XYZLayerName
  | EmptyLayerName;
