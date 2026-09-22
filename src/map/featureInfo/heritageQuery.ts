// Asking the Kulturminner layers what is under a point on the map.
//
// One GetFeatureInfo per ticked RA service, and that is the whole cost model
// here: `kart.ra.no` is the slowest origin in the stack, so the thing that has
// to be bounded is how often the question is put, not how big the answer is.
// Two rules do it. The pixel is **snapped** to a grid before it becomes a
// coordinate, so a resting hand that drifts two pixels is still the same
// question; and hover and click ask that same snapped question with the same
// `FEATURE_COUNT`, so they share one URL and one memo
// (`featureInfoService.ts`), so a click on a spot whose tip is already up costs
// nothing. What decides *when* to ask at all is the pointer wiring in
// `src/heritageInfo/`.

import type Map from 'ol/Map';
import { CULTURAL_HERITAGE_LAYER_IDS } from '../layers/config/themeLayers/culturalHeritage';
import {
  fetchLayerFeatureInfo,
  getQueryableWMSLayers,
} from './featureInfoService';
import type { FeatureInfoReading } from './types';

/**
 * How coarse the question is, in screen pixels. Six is under the WMS's own pick
 * tolerance and about the width of a pin, so snapping to it never moves the
 * answer — it only stops a hand that is holding still from asking twice.
 */
const SNAP_PX = 6;

/** Is there anything on the map a reader could be pointing at? Cheap, and the
 *  gate the pointer wiring checks before it schedules anything. */
export const heritageIsQueryable = (map: Map): boolean =>
  getQueryableWMSLayers(map, CULTURAL_HERITAGE_LAYER_IDS).length > 0;

/**
 * What the Kulturminner layers say about this pixel, or null where they say
 * nothing — which is also the answer when none of them is drawing.
 *
 * Rejects if `signal` aborts, so a caller that has moved on can tell its own
 * cancellation from an empty map.
 */
export const queryHeritageAt = async (
  map: Map,
  pixel: [number, number],
  signal?: AbortSignal,
): Promise<FeatureInfoReading | null> => {
  const layers = getQueryableWMSLayers(map, CULTURAL_HERITAGE_LAYER_IDS);
  if (layers.length === 0) return null;

  const coordinate = map.getCoordinateFromPixel([
    Math.round(pixel[0] / SNAP_PX) * SNAP_PX,
    Math.round(pixel[1] / SNAP_PX) * SNAP_PX,
  ]) as [number, number] | null;
  if (!coordinate) return null;

  const answers = await Promise.all(
    layers.map((layer) =>
      fetchLayerFeatureInfo(layer, coordinate, map, signal),
    ),
  );

  const withFeatures = answers.filter((a) => a.features.length > 0);
  return withFeatures.length > 0 ? { coordinate, layers: withFeatures } : null;
};
