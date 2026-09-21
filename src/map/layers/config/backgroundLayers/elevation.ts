import {
  DEFAULT_LIDAR_PROJECT_STYLE,
  LidarModel,
  LIDAR_COVERAGE_EXTENT_25833,
  NATIONAL_WMS,
} from './lidarProjects';
import { CoverageExtent, WMSBackgroundLayer, XYZBackgroundLayer } from './types';

// Our MapProxy caches of the two mosaics' skyggerelieff, on the app's own grid
// (mapproxy/mapproxy.yaml). The same pixels the WMS below renders, but a cold
// screenful costs one upstream GetMap per 2x2 block instead of one per tile,
// and a second look at the same ground costs none.
const NATIONAL_CACHE_URL: Record<LidarModel, string> = {
  dtm: '/cache/lidar-dtm/{z}/{x}/{y}.png',
  dom: '/cache/lidar-dom/{z}/{x}/{y}.png',
};

// A 1 m product, so past z16 (0.33 m/px) the service is upsampling its own grid
// and OL upsampling the z16 tile says the same thing — without four more levels
// of upstream renders and cache growth. Reads as softer edges when zoomed in.
const NATIONAL_CACHE_MAX_ZOOM = 16;

/**
 * The national mosaic shows any style the WMS publishes; on the DOM side that
 * is skyggerelieff and nothing else.
 *
 * Only skyggerelieff is cached, because only it is worth a cache block and only
 * it is known in advance. The style list is discovered at runtime
 * (`fetchNationalLidarStyles`), so a second one the service starts publishing
 * arrives here with nothing of ours to read and goes to the service itself.
 */
export const buildNationalLidarConfig = (
  style: string,
  model: LidarModel,
): WMSBackgroundLayer | XYZBackgroundLayer => {
  const coverageExtent: CoverageExtent = {
    extent: LIDAR_COVERAGE_EXTENT_25833,
    crs: 'EPSG:25833',
  };

  if (style === DEFAULT_LIDAR_PROJECT_STYLE) {
    return {
      type: 'XYZ',
      layerName: 'lidarHillshade',
      url: NATIONAL_CACHE_URL[model],
      projection: 'EPSG:25833',
      minZoom: 0,
      maxZoom: NATIONAL_CACHE_MAX_ZOOM,
      // A miss here is a GetMap upstream, so preloading would hold tile slots
      // through a 3-12 s render; that a hit is instant does not change it.
      preload: 0,
      coverageExtent,
    };
  }

  return {
    type: 'WMS',
    layerName: 'lidarHillshade',
    // Same-origin via /wms/geonorge/*: wms.geonorge.no direct fails CORS.
    url: NATIONAL_WMS[model].url,
    props: {
      LAYERS: `${NATIONAL_WMS[model].prefix}:${style}`,
      VERSION: '1.3.0',
    },
    coverageExtent,
  };
};
