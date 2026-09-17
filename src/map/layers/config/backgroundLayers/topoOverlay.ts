import { WMSBackgroundLayer } from './types';

// Hybrid's reference features: wms.topo renders any subset of its group layers.
// Two families because the kd_* groups stop around 1:25 000 where the fkb_*
// ones take over; asking for all five lets the server pick per scale.
const REFERENCE_LAYERS = [
  'kd_veger',
  'kd_jernbane',
  'kd_stedsnavn',
  'fkb_samferdsel',
  'fkb_presentasjonsdata',
];

// On the same request: a second TileWMS would double this stack's request
// count. Same kd_/fkb_ handover — kd_hoydekurver draws at 1:70 000, is blank at
// 1:7 000, fkb_hoydekurver the inverse — and hoydekurver_1m / _5m come back
// empty.
const CONTOUR_LAYERS = ['kd_hoydekurver', 'fkb_hoydekurver'];

/** A builder because the LAYERS list is the contours toggle:
 *  `buildOrReuseBackgroundLayer` keys on url + params, so flipping contours
 *  rebuilds this layer and leaves the relief alone. */
export const buildTopoOverlayConfig = (
  contours: boolean,
): WMSBackgroundLayer => {
  const layers = contours
    ? [...REFERENCE_LAYERS, ...CONTOUR_LAYERS]
    : REFERENCE_LAYERS;

  return {
    type: 'WMS',
    layerName: 'topoOverlay',
    url: '/wms/geonorge/wms.topo',
    props: {
      LAYERS: layers.join(','),
      TRANSPARENT: true,
      VERSION: '1.3.0',
    },
    // wms.topo's declared EPSG:25833 bounds; without it OL takes the grid from
    // the UTM33 projection extent and asks for tiles over the Atlantic.
    coverageExtent: {
      extent: [-127998, 6377920, 1145510, 7976800],
      crs: 'EPSG:25833',
    },
  };
};
