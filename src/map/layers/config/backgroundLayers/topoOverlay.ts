import { WMSBackgroundLayer } from './types';

// The reference half of hybrid mode: roads, railways and place names
// drawn on transparency over the LiDAR relief. Kartverket's topo WMS
// renders any subset of its group layers, so asking for only the
// reference features gives a genuine overlay — no terrain, no landcover,
// no background fill — which beats the alternative of fading the LiDAR
// down until the topo map shows through it.
//
// Two families of groups because neither covers the whole zoom range:
// the kd_* groups are the generalized (N50-ish) cartography and stop
// rendering somewhere around 1:25 000, where the fkb_* groups take over
// with the large-scale detail. Asking for all five lets the server
// decide which apply at the current scale.
const REFERENCE_LAYERS = [
  'kd_veger',
  'kd_jernbane',
  'kd_stedsnavn',
  'fkb_samferdsel',
  'fkb_presentasjonsdata',
];

// Contour lines, optional, and on the *same* request rather than a layer of
// their own — a second TileWMS would double this stack's request count for
// what is a modifier, where another group on a request already being made
// costs nothing. The price is that toggling contours re-requests the
// reference features too: one screenful, once.
//
// Same kd_/fkb_ handover as above, and measured the same way rather than
// assumed: a GetMap probe has kd_hoydekurver drawing at 1:70 000 and blank at
// 1:7 000, fkb_hoydekurver the exact inverse, and the pair covering the range.
// hoydekurver_1m / hoydekurver_5m are also published but are the underlying
// feature layers rather than the styled groups, and came back empty at both
// scales.
const CONTOUR_LAYERS = ['kd_hoydekurver', 'fkb_hoydekurver'];

/**
 * Hybrid's overlay, with or without contours. A builder rather than a
 * constant because the LAYERS list *is* the toggle:
 * `buildOrReuseBackgroundLayer` keys on url + params, so flipping contours
 * rebuilds this one layer and leaves the relief under it alone.
 */
export const buildTopoOverlayConfig = (
  contours: boolean,
): WMSBackgroundLayer => {
  const layers = contours
    ? [...REFERENCE_LAYERS, ...CONTOUR_LAYERS]
    : REFERENCE_LAYERS;

  return {
    type: 'WMS',
    layerName: 'topoOverlay',
    // Same /wms/geonorge/* Caddy handler as the LiDAR layers, different
    // service — the handler passes the whole path through, so no proxy
    // config change was needed to add this one.
    url: '/wms/geonorge/wms.topo',
    props: {
      LAYERS: layers.join(','),
      TRANSPARENT: true,
      VERSION: '1.3.0',
    },
    // wms.topo's own declared EPSG:25833 bounds. Same reason as the LiDAR
    // layers: without it OL takes the tile grid from the UTM33 projection
    // extent and asks this on-the-fly renderer for tiles over the North
    // Atlantic.
    coverageExtent: {
      extent: [-127998, 6377920, 1145510, 7976800],
      crs: 'EPSG:25833',
    },
  };
};
