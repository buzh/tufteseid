import {
  LidarModel,
  LIDAR_COVERAGE_EXTENT_25833,
  NATIONAL_WMS,
} from './lidarProjects';
import { WMSBackgroundLayer } from './types';

// The national mosaic shows any style the WMS publishes; on the DOM side that
// is skyggerelieff and nothing else.
export const buildNationalLidarConfig = (
  style: string,
  model: LidarModel,
): WMSBackgroundLayer => ({
  type: 'WMS',
  layerName: 'lidarHillshade',
  // Same-origin via /wms/geonorge/*: wms.geonorge.no direct fails CORS.
  url: NATIONAL_WMS[model].url,
  props: {
    LAYERS: `${NATIONAL_WMS[model].prefix}:${style}`,
    VERSION: '1.3.0',
  },
  coverageExtent: { extent: LIDAR_COVERAGE_EXTENT_25833, crs: 'EPSG:25833' },
});
