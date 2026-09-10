import { atom, getDefaultStore } from 'jotai';
import { atomEffect } from 'jotai-effect';
import {
  addToUrlListParameter,
  removeFromUrlListParameter,
} from '../../shared/utils/urlUtils';
import { mapAtom } from '../atoms';
import {
  featureInfoPanelOpenAtom,
  featureInfoResultAtom,
} from '../featureInfo/atoms';
import {
  type HeritageDetail,
  heritageDetailsAtom,
  heritageOpacityAtom,
  type HeritageRender,
  heritageRenderAtom,
  heritageSitesParams,
  writeHeritageUrlParameters,
} from './heritage';
import { getThemeLayerById, themeLayerConfig } from './themeLayerConfigApi';
import { createThemeLayerFromConfig, ThemeLayerName } from './themeWMS';

export const activeThemeLayersAtom = atom<Set<ThemeLayerName>>(new Set([]));

/**
 * The one theme layer whose WMS request the user can reshape. The other four
 * RA services publish a single style each, so there is nothing to say about
 * them beyond on/off and how strongly to draw them.
 */
const RESHAPEABLE: ThemeLayerName = 'heritageSites';

const paramsFor = (
  layerName: ThemeLayerName,
  details: ReadonlySet<HeritageDetail>,
  render: HeritageRender,
) => (layerName === RESHAPEABLE ? heritageSitesParams(details, render) : null);

export const themeLayerEffect = atomEffect((get) => {
  const themeLayers = get(activeThemeLayersAtom);
  // Read, so changing any of them re-runs the effect and reshapes the layers
  // already on the map. The add/remove diff below is a no-op on those runs.
  const heritageDetails = get(heritageDetailsAtom);
  const heritageRender = get(heritageRenderAtom);
  const heritageOpacity = get(heritageOpacityAtom);
  const store = getDefaultStore();
  const map = store.get(mapAtom);
  const mapProjection = map.getView().getProjection().getCode();
  const themelayersActive = new Set(
    map
      .getLayers()
      .getArray()
      .filter((layer) => {
        const id = layer.get('id');
        return typeof id === 'string' && id.startsWith('theme.');
      })
      .map((layer) => layer.get('id').substring(6) as ThemeLayerName),
  );

  const themeLayersToAdd = Array.from(themeLayers).filter(
    (layerName) => !themelayersActive.has(layerName),
  );
  const themeLayersToRemove = Array.from(themelayersActive).filter(
    (layerName) => !themeLayers.has(layerName),
  );

  themeLayersToAdd.forEach((layerName) => {
    const layerExists = map
      .getLayers()
      .getArray()
      .some((layer) => layer.get('id') === `theme.${layerName}`);
    if (layerExists) {
      console.warn('Layer already exists on map');
      return;
    }

    const layerDef = getThemeLayerById(themeLayerConfig, layerName);

    if (!layerDef) {
      console.warn(`Layer definition not found for layer name: ${layerName}`);
      return;
    }

    const params = paramsFor(layerName, heritageDetails, heritageRender);
    const layerToAdd = createThemeLayerFromConfig(
      themeLayerConfig,
      layerDef,
      mapProjection,
      params ?? undefined,
    );

    if (!layerToAdd) {
      console.warn(
        `Could not create theme layer: ${layerName} for projection: ${mapProjection}`,
      );
      return;
    }
    layerToAdd.setZIndex(10);
    map.addLayer(layerToAdd);
    addToUrlListParameter('themeLayers', layerName);
  });

  themeLayersToRemove.forEach((layerName) => {
    const layer = map
      .getLayers()
      .getArray()
      .find((layer) => layer.get('id') === `theme.${layerName}`);
    if (layer) {
      map.removeLayer(layer);

      const store = getDefaultStore();
      const currentResult = store.get(featureInfoResultAtom);
      if (currentResult) {
        const remainingLayers = currentResult.layers.filter(
          (l) => l.layerId !== `theme.${layerName}`,
        );
        if (remainingLayers.length === 0) {
          store.set(featureInfoResultAtom, null);
          store.set(featureInfoPanelOpenAtom, false);
        } else if (remainingLayers.length !== currentResult.layers.length) {
          store.set(featureInfoResultAtom, {
            ...currentResult,
            layers: remainingLayers,
          });
        }
      }
    }
    removeFromUrlListParameter('themeLayers', layerName);
  });

  // Reshape whatever is on the map now — including the layers just added, so
  // one pass covers both "the settings changed" and "a source was switched
  // on while they were already off default".
  map
    .getLayers()
    .getArray()
    .forEach((layer) => {
      const id = layer.get('id');
      if (typeof id !== 'string' || !id.startsWith('theme.')) return;
      layer.setOpacity(heritageOpacity);

      const layerName = id.substring(6) as ThemeLayerName;
      if (layerName !== RESHAPEABLE) return;
      const params = paramsFor(layerName, heritageDetails, heritageRender);
      // Nothing selected renders nothing, so say so by hiding the layer
      // rather than by sending a request whose only possible answer is a
      // transparent tile.
      layer.setVisible(params !== null);
      if (!params) return;

      const source = (layer as { getSource?: () => unknown }).getSource?.();
      if (!isWmsSource(source)) return;
      const current = source.getParams();
      // updateParams invalidates the tile cache and re-requests the whole
      // screen, so only when something actually moved: this effect also runs
      // for unrelated theme-layer adds and removes.
      if (current.LAYERS === params.LAYERS && current.STYLES === params.STYLES)
        return;
      source.updateParams(params);
    });

  writeHeritageUrlParameters(heritageDetails, heritageRender, heritageOpacity);
});

type WmsSource = {
  getParams: () => Record<string, unknown>;
  updateParams: (params: Record<string, unknown>) => void;
};

const isWmsSource = (source: unknown): source is WmsSource =>
  typeof (source as WmsSource | null)?.updateParams === 'function' &&
  typeof (source as WmsSource | null)?.getParams === 'function';
