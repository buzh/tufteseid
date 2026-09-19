// The cached ground: RVT's combined VAT — hillshade, slope, positive openness
// and sky-view in one picture — precomputed over a single LiDAR acquisition and
// written to disk as plain tiles. `vat-cache/build_tiles.py` made them and
// `/cvat/manifest.json` beside them states the presets, the blend order, the
// radii per level and the digest of the run.
//
// Not a service: Caddy's own `file_server` serves the bind-mounted store, so
// there is no proxy route, no wmscache entry and no CSP host — `img-src 'self'`
// already covers it.

import { XYZBackgroundLayer } from './types';

/**
 * The one acquisition in the store. Byte-identical to the `LidarProject.id` the
 * per-project WMS publishes, which is what lets `chooseAutoDataset` test the
 * footprint against the viewport ranking it already has, with no name mapping
 * and no second coverage source.
 *
 * A constant because there is one. With two the list comes off the manifest.
 */
export const CVAT_ACQUISITION_ID = 'Vestfold og Telemark 5pkt 2021';

/**
 * The levels `build_tiles.py` wrote, on the app's own grid (`wmsTileGrid.ts`):
 * z15 at 0.661 m/px down to z12 at 5.289 m/px. Radii are RVT's own pixels at
 * every level, so the four are related pictures rather than one at four sizes —
 * the reach of the visualization grows as you zoom out.
 */
const CVAT_MIN_ZOOM = 12;
const CVAT_MAX_ZOOM = 15;

/**
 * The store's envelope, 185.6 × 102.9 km, of which the acquisition fills 6 %.
 * As the layer's extent it stops OL asking outside; inside it the 94 % that
 * were never written answer 404, which OL marks errored and leaves
 * transparent — and that transparency is the coverage mask, with the faded
 * mosaic underneath showing through.
 */
const CVAT_COVERAGE_EXTENT_25833: [number, number, number, number] = [
  61055, 6557418, 246691, 6660366,
];

export const CVAT_GROUND_CONFIG: XYZBackgroundLayer = {
  type: 'XYZ',
  layerName: 'lidarCvat',
  url: '/cvat/{z}/{x}/{y}.webp',
  projection: 'EPSG:25833',
  minZoom: CVAT_MIN_ZOOM,
  maxZoom: CVAT_MAX_ZOOM,
  coverageExtent: { extent: CVAT_COVERAGE_EXTENT_25833, crs: 'EPSG:25833' },
};
