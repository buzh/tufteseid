export type WMSLayerName = 'lidarHillshade' | 'lidarProject';

export type ArcGISImageLayerName = 'flyfotoProject';

export type XYZLayerName =
  'lidarCvat' | 'lidarHillshade' | 'amtskart' | 'flyfoto' | 'topoOverlay';

export type EmptyLayerName = 'empty';

export type WMTSLayerName =
  'topo' | 'topograatone' | 'toporaster' | 'sjokartraster';

export type BackgroundLayerName =
  | WMTSLayerName
  | WMSLayerName
  | ArcGISImageLayerName
  | XYZLayerName
  | EmptyLayerName;
