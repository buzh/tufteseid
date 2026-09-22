// Whether a pixel landed on a saved spot.
//
// Apart from the layer that draws them, because two surfaces ask it: the layer
// itself, to open the card, and the Kulturminner handler, to stand down. A
// click on a pin is the pin's — the register answering the same click would put
// a heritage popup over the card that click just opened.

import type Map from 'ol/Map';

import type { SpotRecord } from '../api/spots';

export const SPOT_LAYER_ID = 'spotsLayer';
export const SPOT_RECORD_KEY = 'spotRecord';

/** How far off a pin a click still counts, in pixels. */
const HIT_TOLERANCE = 6;

/** The spot under `pixel`, or undefined. Restricted to the spots' own layer,
 *  so a pin over a Kulturminner polygon does not answer for the polygon. */
export const spotAtPixel = (
  map: Map,
  pixel: number[],
): SpotRecord | undefined =>
  map.forEachFeatureAtPixel(
    pixel,
    (feature) => feature.get(SPOT_RECORD_KEY) as SpotRecord | undefined,
    {
      hitTolerance: HIT_TOLERANCE,
      layerFilter: (layer) => layer.get('id') === SPOT_LAYER_ID,
    },
  );
