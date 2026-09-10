// Norge i bilder ortofoto as a background mode: either the seamless
// best-available mosaic, or one specific acquisition out of the archive.
//
// The archive half is why this is not simply another WMS entry.
// /wms/ortofoto publishes only the merged `ortofoto` layer and
// /wms/ortofoto_prosjekter 403s — per-project imagery is not reachable over
// WMS at all. It comes out of an ArcGIS ImageServer whose mosaic catalogue
// carries a `prosjektnavn` column, so one acquisition is picked with a
// mosaicRule `where` clause. Same service, same column and the same quoting
// as the lokalitet stitch in src/localities/flyfoto.ts, which shares both
// helpers with this file.
//
// Walking that ring with W/S is the point of the mode: the same ground in
// 2024, 1963 and 1937 without leaving the map.

import { atom } from 'jotai';
import {
  FLYFOTO_LAYER,
  FLYFOTO_PROJECT_IMAGESERVER,
  FLYFOTO_WMS_URL,
  flyfotoMosaicRule,
} from '../../../../localities/flyfoto';
import type { FlyfotoProject } from '../../../../localities/flyfotoProjects';
import type { ArcGISImageBackgroundLayer, WMSBackgroundLayer } from './types';

// The <BoundingBox CRS="EPSG:25833"> the ortofoto WMS advertises in its own
// GetCapabilities. Well beyond the mainland — it reaches past Svalbard —
// but EPSG:25833 reaches very much further, and without an extent OL asks
// the renderer for full on-the-fly renders over the Atlantic and western
// Russia every time the map is zoomed out.
const FLYFOTO_COVERAGE_EXTENT_25833: [number, number, number, number] = [
  -250025, 6299985, 1211155, 8985010,
];

// The seamless mosaic. JPEG, not PNG: measured on a 512 px tile over Oslo
// the same pixels are 68 kB as JPEG and 528 kB as PNG, and a live
// background spends that per tile per pan. There is no transparency to
// lose — the mosaic is opaque wherever it has anything, which is the whole
// advertised extent, so nothing is stacked underneath it either.
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
    // jpgpng is the only workable format here: the service answers JPEG
    // where the acquisition has coverage and a ~1 kB transparent PNG where
    // it does not, so the mosaic and topo underneath show through the gaps.
    // Plain jpg paints those gaps opaque black; png32 is eight times the
    // bytes for the same pixels. It costs one thing — the response comes
    // back as application/octet-stream, which nib-proxy re-labels by
    // sniffing the magic bytes, because Caddy sends nosniff.
    FORMAT: 'jpgpng',
    mosaicRule: flyfotoMosaicRule(project.id),
  },
  // The acquisition's own bounds, not the service's. One flight covers a
  // town; the ImageServer advertises every flight ever flown, so the
  // per-project box is what actually culls anything.
  coverageExtent: { extent: project.bboxLonLat, crs: 'EPSG:4326' },
});

// Which acquisition 'flyfotoProject' means. Null until the user picks one,
// which is why 'flyfotoProject' is not a valid startup layer — exactly the
// situation activeLidarProjectAtom is in.
export const activeFlyfotoProjectAtom = atom<FlyfotoProject | null>(null);
