export type WMSLayerName =
  | 'lidarHillshade'
  // Kartverket's amtskart series, georeferenced and stitched. A Standard
  // variant like the three WMTS renderings below, but a WMS because the
  // historical maps are not in the tile cache.
  | 'amtskart'
  // Dynamic per-acquisition LiDAR project. The concrete project + style
  // come from activeLidarProjectAtom, not from a static layer config.
  | 'lidarProject'
  // Norge i bilder's seamless best-available ortofoto mosaic.
  | 'flyfoto'
  // Transparent roads/place-names overlay for hybrid mode. Never a
  // background *choice* — it's always stacked on top of one, so it
  // isn't in allConfiguredBackgroundLayers and backgroundLayerAtom is
  // never set to it.
  | 'topoOverlay';

// One specific ortofoto acquisition. Its own type because it is not a WMS
// at all: /wms/ortofoto publishes only the merged mosaic and
// /wms/ortofoto_prosjekter 403s, so per-project imagery comes out of an
// ArcGIS ImageServer, selected with a mosaicRule over its catalogue.
export type ArcGISImageLayerName = 'flyfotoProject';

export type EmptyLayerName = 'empty';

// The four finished cartographies Kartverket's tile cache publishes, which
// are also four of the five Standard variants (see standardVariants.ts). Each
// name is the WMTS layer identifier it asks the cache for, so they cannot be
// renamed to something friendlier here.
export type WMTSLayerName =
  | 'topo'
  | 'topograatone'
  | 'toporaster'
  | 'sjokartraster';

export type BackgroundLayerName =
  | WMTSLayerName
  | WMSLayerName
  | ArcGISImageLayerName
  | EmptyLayerName;
