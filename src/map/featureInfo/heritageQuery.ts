// One GetFeatureInfo per ticked RA service. Hover and click put the same
// snapped question with the same `FEATURE_COUNT`, so they share one URL and one
// memo in `featureInfoService.ts`. When to ask is `src/heritageInfo/`.

import type Map from 'ol/Map';
import { CULTURAL_HERITAGE_LAYER_IDS } from '../layers/config/themeLayers/culturalHeritage';
import {
  fetchLayerFeatureInfo,
  getQueryableWMSLayers,
} from './featureInfoService';
import type { FeatureInfoReading } from './types';

/** Snap grid in screen pixels. Under the WMS's own pick tolerance, so snapping
 *  never moves the answer. */
const SNAP_PX = 6;

/** Cheap gate: is any queryable register drawing. */
export const heritageIsQueryable = (map: Map): boolean =>
  getQueryableWMSLayers(map, CULTURAL_HERITAGE_LAYER_IDS).length > 0;

/**
 * What the Kulturminner layers say about this pixel; null where they say
 * nothing, or where none of them is drawing. Rejects if `signal` aborts, so a
 * caller can tell its own cancellation from an empty map.
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
