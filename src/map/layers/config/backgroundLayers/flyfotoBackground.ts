import { FLYFOTO_PROJECT_IMAGESERVER, flyfotoMosaicRule } from './flyfoto';
import type { FlyfotoProject } from './flyfotoProjects';
import { halved } from '../../../compare/halves';
import { VIEW_MAX_ZOOM } from '../../wmsTileGrid';
import type { ArcGISImageBackgroundLayer, XYZBackgroundLayer } from './types';

// The <BoundingBox CRS="EPSG:25833"> the ortofoto WMS advertises; without it OL
// asks for tiles over open ocean on every zoom out.
const FLYFOTO_COVERAGE_EXTENT_25833: [number, number, number, number] = [
  -250025, 6299985, 1211155, 8985010,
];

const FLYFOTO_PROJECT_MAX_ZOOM = 18;

export const FLYFOTO_MOSAIC_CONFIG: XYZBackgroundLayer = {
  type: 'XYZ',
  layerName: 'flyfoto',
  url: '/cache/flyfoto/{z}/{x}/{y}.jpeg',
  projection: 'EPSG:25833',
  minZoom: 0,
  maxZoom: VIEW_MAX_ZOOM,
  preload: 0,
  sparse: false,
  coverageExtent: {
    extent: FLYFOTO_COVERAGE_EXTENT_25833,
    crs: 'EPSG:25833',
  },
};

export const buildFlyfotoProjectConfig = (
  project: FlyfotoProject,
): ArcGISImageBackgroundLayer => ({
  type: 'ArcGISImage',
  layerName: 'flyfotoProject',
  url: FLYFOTO_PROJECT_IMAGESERVER,
  params: {
    // JPEG inside coverage, transparent PNG outside; jpg paints the gaps black.
    // Arrives as octet-stream, which nib-proxy re-labels by magic bytes.
    FORMAT: 'jpgpng',
    mosaicRule: flyfotoMosaicRule(project.id),
  },
  // z18 is 0.083 m/px; ortofoto runs 0.04 m over cities, 0.25-0.5 m elsewhere.
  maxZoom: FLYFOTO_PROJECT_MAX_ZOOM,
  coverageExtent: { extent: project.bboxLonLat, crs: 'EPSG:4326' },
});

export const activeFlyfotoProjectHalves = halved<FlyfotoProject | null>(null);
