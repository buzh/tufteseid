import { getDefaultStore } from 'jotai';
import VectorLayer from 'ol/layer/Vector';
import { mapAtom } from './atoms';
import type { MapLayers } from './layers';

/*
 * Looking up the six vector layers `layers.ts` creates, by the id they were
 * created with.
 *
 * These used to live in `draw/drawControls/hooks/mapLayers.ts`, which was an
 * upstream accident: four of the six have nothing to do with drawing, and the
 * measure tool, the property InfoBox and the search markers all had to reach
 * into the drawing subsystem to find their own layer.
 *
 * A file of their own rather than the bottom of `layers.ts`, where they would
 * sit better: `atoms.ts` imports `mapLayers` and *builds the map with it at
 * module-eval time*, so a `layers.ts` that imported `mapAtom` back would be a
 * runtime cycle — evaluate `layers.ts` first and `mapLayers` is still in its
 * temporal dead zone when `atoms.ts` reaches for it. The `MapLayers` import
 * below is type-only, so it is erased and adds no edge.
 */
const layerById = (id: keyof MapLayers) =>
  getDefaultStore()
    .get(mapAtom)
    .getLayers()
    .getArray()
    .find((layer) => layer.get('id') === id) as VectorLayer | undefined;

/*
 * The non-null returns are a lie these have always told: before the map is
 * built there is no layer, and the old implementation indexed `[0]` off an
 * empty array and cast the `undefined` away. Callers that know this already
 * optional-chain. Kept as it was so that this stays a move — tightening the
 * signatures is a separate change with its own set of call sites to fix.
 */
export const getDrawLayer = (): VectorLayer =>
  layerById('drawLayer') as VectorLayer;

export const getDrawOverlayLayer = (): VectorLayer =>
  layerById('drawOverlayLayer') as VectorLayer;

export const getMarkerLayer = (): VectorLayer =>
  layerById('markerLayer') as VectorLayer;

export const getPosterMarkerLayer = (): VectorLayer =>
  layerById('posterMarkerLayer') as VectorLayer;

export const getMeasureLayer = (): VectorLayer =>
  layerById('measureLayer') as VectorLayer;

export const getPropertyGeometryLayer = (): VectorLayer | null =>
  layerById('propertyGeometryLayer') ?? null;
