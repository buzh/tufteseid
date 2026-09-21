// Asked to render per request, because what is asked for is not fixed.
export type WMSLayerName =
  // Only the mosaic's non-default styles reach here; skyggerelieff is cached.
  | 'lidarHillshade'
  // Project and style come from activeLidarProjectAtom, not a static config.
  | 'lidarProject';

// One ortofoto acquisition, not a WMS: /wms/ortofoto publishes only the merged
// mosaic and /wms/ortofoto_prosjekter 403s, so this is an ArcGIS ImageServer.
export type ArcGISImageLayerName = 'flyfotoProject';

// Read as tiles off a {z}/{x}/{y} store rather than rendered on demand. Two
// kinds: `lidarCvat` is ours, computed here; the rest are upstream layers whose
// LAYERS and STYLES never change, held by MapProxy on the app's own grid so a
// screenful costs one GetMap per meta-tile rather than one per tile.
export type XYZLayerName =
  | 'lidarCvat'
  | 'lidarHillshade'
  // Amtskart is not in Kartverket's WMTS cache: the pre-1917 series is a WMS.
  | 'amtskart'
  // Norge i bilder's seamless best-available ortofoto mosaic.
  | 'flyfoto'
  // Hybrid's transparent overlay: stacked on a background, never a choice.
  | 'topoOverlay';

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
