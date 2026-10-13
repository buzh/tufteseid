import type Map from 'ol/Map';
import { CULTURAL_HERITAGE_LAYER_IDS } from '../layers/config/themeLayers/culturalHeritage';
import {
  fetchLayerFeatureInfo,
  getQueryableWMSLayers,
} from './featureInfoService';
import type { FeatureInfoReading } from './types';

const SNAP_PX = 6;

export const heritageIsQueryable = (map: Map): boolean =>
  getQueryableWMSLayers(map, CULTURAL_HERITAGE_LAYER_IDS).length > 0;

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
