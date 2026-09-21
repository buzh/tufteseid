import { VIEW_MAX_ZOOM } from '../../wmsTileGrid';
import { CoverageExtent, XYZBackgroundLayer } from './types';

// Two MapProxy caches, one per state of the contours toggle. Which group layers
// each asks wms.topo for, and why they are one GetMap rather than two stacked
// layers, is in mapproxy/mapproxy.yaml; from here they are two tile stores.
const OVERLAY_URL = {
  plain: '/cache/topo-ref/{z}/{x}/{y}.png',
  contours: '/cache/topo-ref-contours/{z}/{x}/{y}.png',
};

// wms.topo's declared EPSG:25833 bounds; without it OL takes the grid from the
// UTM33 projection extent and asks for tiles over the Atlantic.
const TOPO_COVERAGE_EXTENT_25833: CoverageExtent = {
  extent: [-127998, 6377920, 1145510, 7976800],
  crs: 'EPSG:25833',
};

/** A builder because the url is the contours toggle:
 *  `buildOrReuseBackgroundLayer` keys on url, so flipping contours rebuilds
 *  this layer and leaves the relief alone. */
export const buildTopoOverlayConfig = (
  contours: boolean,
): XYZBackgroundLayer => ({
  type: 'XYZ',
  layerName: 'topoOverlay',
  url: contours ? OVERLAY_URL.contours : OVERLAY_URL.plain,
  projection: 'EPSG:25833',
  minZoom: 0,
  maxZoom: VIEW_MAX_ZOOM,
  // A miss is a GetMap upstream; see the field's own note in types.ts.
  preload: 0,
  sparse: false,
  coverageExtent: TOPO_COVERAGE_EXTENT_25833,
});
