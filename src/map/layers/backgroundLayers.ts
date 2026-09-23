export type WMSLayerName = 'lidarHillshade' | 'lidarProject';

// NiB publishes no per-project WMS (/wms/ortofoto_prosjekter 403s), so an
// ortofoto acquisition comes off an ArcGIS ImageServer.
export type ArcGISImageLayerName = 'flyfotoProject';

export type XYZLayerName =
  | 'lidarCvat'
  | 'lidarHillshade'
  | 'amtskart'
  | 'flyfoto'
  | 'topoOverlay';

export type EmptyLayerName = 'empty';

// Each name is the WMTS identifier Kartverket's cache is asked for.
export type WMTSLayerName =
  | 'topo'
  | 'topograatone'
  | 'toporaster'
  | 'sjokartraster';

export type BackgroundLayerName =
  | WMTSLayerName
  | WMSLayerName
  | ArcGISImageLayerName
  | XYZLayerName
  | EmptyLayerName;
