import {
  DEFAULT_LIDAR_PROJECT_STYLE,
  LidarModel,
  LIDAR_COVERAGE_EXTENT_25833,
  NATIONAL_WMS,
} from './lidarProjects';
import { CoverageExtent, WMSBackgroundLayer, XYZBackgroundLayer } from './types';

const NATIONAL_CACHE_URL: Record<LidarModel, string> = {
  dtm: '/cache/lidar-dtm/{z}/{x}/{y}.png',
  dom: '/cache/lidar-dom/{z}/{x}/{y}.png',
};

// The same MBTiles published with no source behind them, so a miss is
// transparent rather than an upstream render. `tileGuard.ts` swaps to these
// while the `hoyde` breaker is open.
const NATIONAL_HELD_URL: Record<LidarModel, string> = {
  dtm: '/cache/lidar-dtm-held/{z}/{x}/{y}.png',
  dom: '/cache/lidar-dom-held/{z}/{x}/{y}.png',
};

// A 1 m product; z16 is 0.33 m/px, past which the service upsamples its own
// grid.
const NATIONAL_CACHE_MAX_ZOOM = 16;

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
      heldUrl: NATIONAL_HELD_URL[model],
      projection: 'EPSG:25833',
      minZoom: 0,
      maxZoom: NATIONAL_CACHE_MAX_ZOOM,
      interpolate: false,
      preload: 0,
      sparse: false,
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
    maxZoom: NATIONAL_CACHE_MAX_ZOOM,
    interpolate: false,
    coverageExtent,
  };
};
