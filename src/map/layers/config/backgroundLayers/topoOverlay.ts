import { VIEW_MAX_ZOOM } from '../../wmsTileGrid';
import { CoverageExtent, XYZBackgroundLayer } from './types';

const OVERLAY_URL = {
  plain: '/cache/topo-ref/{z}/{x}/{y}.png',
  contours: '/cache/topo-ref-contours/{z}/{x}/{y}.png',
};

// wms.topo's declared EPSG:25833 bounds; without it OL takes the grid from the
// projection extent and asks for tiles over open ocean.
const TOPO_COVERAGE_EXTENT_25833: CoverageExtent = {
  extent: [-127998, 6377920, 1145510, 7976800],
  crs: 'EPSG:25833',
};

export const buildTopoOverlayConfig = (
  contours: boolean,
): XYZBackgroundLayer => ({
  type: 'XYZ',
  layerName: 'topoOverlay',
  url: contours ? OVERLAY_URL.contours : OVERLAY_URL.plain,
  projection: 'EPSG:25833',
  minZoom: 0,
  maxZoom: VIEW_MAX_ZOOM,
  preload: 0,
  sparse: false,
  coverageExtent: TOPO_COVERAGE_EXTENT_25833,
});
