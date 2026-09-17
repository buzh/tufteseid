import { getDefaultStore } from 'jotai';
import VectorLayer from 'ol/layer/Vector';
import { mapAtom } from './atoms';
import type { MapLayers } from './layers';

// Looking up the vector layers `layers.ts` creates, by their id. A file of
// their own because `atoms.ts` builds the map from `mapLayers` at module-eval
// time, so a `layers.ts` importing `mapAtom` back would be a runtime cycle.
const layerById = (id: keyof MapLayers) =>
  getDefaultStore()
    .get(mapAtom)
    .getLayers()
    .getArray()
    .find((layer) => layer.get('id') === id) as VectorLayer | undefined;

// The non-null returns are a lie: before the map is built there is no layer.
export const getMarkerLayer = (): VectorLayer =>
  layerById('markerLayer') as VectorLayer;

export const getMeasureLayer = (): VectorLayer =>
  layerById('measureLayer') as VectorLayer;

export const getPropertyGeometryLayer = (): VectorLayer | null =>
  layerById('propertyGeometryLayer') ?? null;
