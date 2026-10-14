import {
  DEFAULT_LIDAR_PROJECT_STYLE,
  LidarModel,
  LIDAR_COVERAGE_EXTENT_25833,
  NATIONAL_WMS,
} from './lidarProjects';
import {
  CoverageExtent,
  WMSBackgroundLayer,
  XYZBackgroundLayer,
} from './types';

const NATIONAL_CACHE_URL: Record<LidarModel, string> = {
  dtm: '/cache/lidar-dtm/{z}/{x}/{y}.png',
  dom: '/cache/lidar-dom/{z}/{x}/{y}.png',
};

const NATIONAL_HELD_URL: Record<LidarModel, string> = {
  dtm: '/cache/lidar-dtm-held/{z}/{x}/{y}.png',
  dom: '/cache/lidar-dom-held/{z}/{x}/{y}.png',
};

export const NATIONAL_CACHE_MAX_ZOOM = 16;

const NATIONAL_COVERAGE: CoverageExtent = {
  extent: LIDAR_COVERAGE_EXTENT_25833,
  crs: 'EPSG:25833',
};

const nationalCacheConfig = (
  url: string,
  heldUrl?: string,
): XYZBackgroundLayer => ({
  type: 'XYZ',
  layerName: 'lidarHillshade',
  url,
  ...(heldUrl ? { heldUrl } : {}),
  projection: 'EPSG:25833',
  minZoom: 0,
  maxZoom: NATIONAL_CACHE_MAX_ZOOM,
  interpolate: false,
  preload: 0,
  sparse: false,
  coverageExtent: NATIONAL_COVERAGE,
});

export const buildHeldNationalLidarConfig = (
  model: LidarModel,
): XYZBackgroundLayer => nationalCacheConfig(NATIONAL_HELD_URL[model]);

export const buildNationalLidarConfig = (
  style: string,
  model: LidarModel,
): WMSBackgroundLayer | XYZBackgroundLayer => {
  if (style === DEFAULT_LIDAR_PROJECT_STYLE) {
    return nationalCacheConfig(
      NATIONAL_CACHE_URL[model],
      NATIONAL_HELD_URL[model],
    );
  }

  return {
    type: 'WMS',
    layerName: 'lidarHillshade',
    url: NATIONAL_WMS[model].url,
    props: {
      LAYERS: `${NATIONAL_WMS[model].prefix}:${style}`,
      VERSION: '1.3.0',
    },
    maxZoom: NATIONAL_CACHE_MAX_ZOOM,
    interpolate: false,
    coverageExtent: NATIONAL_COVERAGE,
  };
};
