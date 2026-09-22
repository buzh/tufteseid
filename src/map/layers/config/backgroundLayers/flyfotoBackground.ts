// Norge i bilder ortofoto: the seamless mosaic, or one acquisition. The latter
// is not reachable over WMS (/wms/ortofoto publishes only the merged layer,
// /wms/ortofoto_prosjekter 403s), so it comes from an ArcGIS ImageServer, its
// catalogue's `prosjektnavn` column picked with a mosaicRule `where` clause.

import { FLYFOTO_PROJECT_IMAGESERVER, flyfotoMosaicRule } from './flyfoto';
import type { FlyfotoProject } from './flyfotoProjects';
import { halved } from '../../../compare/halves';
import { VIEW_MAX_ZOOM } from '../../wmsTileGrid';
import type { ArcGISImageBackgroundLayer, XYZBackgroundLayer } from './types';

// The <BoundingBox CRS="EPSG:25833"> the ortofoto WMS advertises; without it OL
// asks for on-the-fly renders over the Atlantic on every zoom out.
const FLYFOTO_COVERAGE_EXTENT_25833: [number, number, number, number] = [
  -250025, 6299985, 1211155, 8985010,
];

const FLYFOTO_PROJECT_MAX_ZOOM = 18;

// Our MapProxy cache of the mosaic, which reaches NiB through the same
// token-injecting sidecar wmscache does. JPEG, not PNG: 68 kB against 528 kB
// for a 512 px tile over Oslo, and the mosaic is opaque over its whole extent,
// so there is no transparency to lose.
export const FLYFOTO_MOSAIC_CONFIG: XYZBackgroundLayer = {
  type: 'XYZ',
  layerName: 'flyfoto',
  url: '/cache/flyfoto/{z}/{x}/{y}.jpeg',
  projection: 'EPSG:25833',
  minZoom: 0,
  maxZoom: VIEW_MAX_ZOOM,
  // A miss is a GetMap upstream; see the field's own note in types.ts.
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
    // jpgpng answers JPEG where the acquisition has coverage and a ~1 kB
    // transparent PNG where it does not; jpg paints the gaps black, png32 costs
    // 8x. It arrives as octet-stream, which nib-proxy re-labels by magic bytes.
    FORMAT: 'jpgpng',
    mosaicRule: flyfotoMosaicRule(project.id),
  },
  // Ortofoto acquisitions run 0.04 m over cities and 0.25-0.5 m in the field;
  // z18 is 0.083 m/px, which covers all but the very finest urban flights and
  // leaves z19-z20 as interpolation nobody can read anything new out of. Set
  // one level deeper than the LiDAR cap because the spread is wider and a
  // photograph rewards magnification in a way a hillshade does not.
  maxZoom: FLYFOTO_PROJECT_MAX_ZOOM,
  // The acquisition's own bounds: the ImageServer advertises every flight.
  coverageExtent: { extent: project.bboxLonLat, crs: 'EPSG:4326' },
});

// Which acquisition 'flyfotoProject' means; null until one is picked, which is
// why it is not a valid startup layer. Halved for the two-ground views.
export const activeFlyfotoProjectHalves = halved<FlyfotoProject | null>(null);
