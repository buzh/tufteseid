// Norge i bilder ortofoto: the seamless mosaic, or one acquisition. The latter
// is not reachable over WMS (/wms/ortofoto publishes only the merged layer,
// /wms/ortofoto_prosjekter 403s), so it comes from an ArcGIS ImageServer, its
// catalogue's `prosjektnavn` column picked with a mosaicRule `where` clause.

import {
  FLYFOTO_LAYER,
  FLYFOTO_PROJECT_IMAGESERVER,
  FLYFOTO_WMS_URL,
  flyfotoMosaicRule,
} from './flyfoto';
import type { FlyfotoProject } from './flyfotoProjects';
import { halved } from '../../../compare/halves';
import type { ArcGISImageBackgroundLayer, WMSBackgroundLayer } from './types';

// The <BoundingBox CRS="EPSG:25833"> the ortofoto WMS advertises; without it OL
// asks for on-the-fly renders over the Atlantic on every zoom out.
const FLYFOTO_COVERAGE_EXTENT_25833: [number, number, number, number] = [
  -250025, 6299985, 1211155, 8985010,
];

// JPEG, not PNG: 68 kB against 528 kB for a 512 px tile over Oslo, and the
// mosaic is opaque over its whole extent, so there is no transparency to lose.
export const FLYFOTO_MOSAIC_CONFIG: WMSBackgroundLayer = {
  type: 'WMS',
  layerName: 'flyfoto',
  url: FLYFOTO_WMS_URL,
  props: {
    LAYERS: FLYFOTO_LAYER,
    VERSION: '1.3.0',
    FORMAT: 'image/jpeg',
  },
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
  // The acquisition's own bounds: the ImageServer advertises every flight.
  coverageExtent: { extent: project.bboxLonLat, crs: 'EPSG:4326' },
});

// Which acquisition 'flyfotoProject' means; null until one is picked, which is
// why it is not a valid startup layer. Halved for the compare curtain.
export const activeFlyfotoProjectHalves = halved<FlyfotoProject | null>(null);
export const activeFlyfotoProjectAtom = activeFlyfotoProjectHalves.focused;
