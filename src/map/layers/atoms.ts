import { atom, getDefaultStore } from 'jotai';
import { atomEffect } from 'jotai-effect';
import {
  addToUrlListParameter,
  removeFromUrlListParameter,
} from '../../shared/utils/urlUtils';
import { mapAtom } from '../atoms';
import { heritagePopupAtom, heritageTipAtom } from '../featureInfo/atoms';
import {
  type HeritageDetail,
  heritageDetailsAtom,
  heritageHiddenAtom,
  heritageOpacityAtom,
  type HeritageRender,
  heritageRenderAtom,
  heritageSitesParams,
  writeHeritageUrlParameters,
} from './heritage';
import { getThemeLayerById, themeLayerConfig } from './themeLayerConfigApi';
import { createThemeLayerFromConfig, ThemeLayerName } from './themeWMS';

export const activeThemeLayersAtom = atom<Set<ThemeLayerName>>(new Set([]));

// Module-level for a stable identity: a fresh `new Set()` per read re-runs
// every effect below.
const NO_THEME_LAYERS: ReadonlySet<ThemeLayerName> = new Set();

/** Which sources are on the map, as opposed to which are ticked; the eye
 *  (`heritageHiddenAtom`) is the difference. */
export const shownThemeLayersAtom = atom<ReadonlySet<ThemeLayerName>>((get) =>
  get(heritageHiddenAtom) ? NO_THEME_LAYERS : get(activeThemeLayersAtom),
);

// The one theme layer whose WMS request can be reshaped; the other four RA
// services publish a single style each. Exported because the surface that
// offers the registers and the renders has to know which source they belong to,
// and a second copy of the name is how the two would come apart.
export const RESHAPEABLE_THEME_LAYER: ThemeLayerName = 'heritageSites';

// A reading is what a layer answered, so it cannot outlive the layer. Dropping
// the source's own features rather than the whole reading is what keeps a card
// standing when one of several ticked registers is turned off underneath it.
const forgetReadingsFrom = (layerId: string) => {
  const store = getDefaultStore();
  for (const readingAtom of [heritageTipAtom, heritagePopupAtom]) {
    const reading = store.get(readingAtom);
    if (!reading) continue;
    const layers = reading.layers.filter((l) => l.layerId !== layerId);
    if (layers.length === reading.layers.length) continue;
    store.set(readingAtom, layers.length > 0 ? { ...reading, layers } : null);
  }
};

const paramsFor = (
  layerName: ThemeLayerName,
  details: ReadonlySet<HeritageDetail>,
  render: HeritageRender,
) =>
  layerName === RESHAPEABLE_THEME_LAYER
    ? heritageSitesParams(details, render)
    : null;

export const themeLayerEffect = atomEffect((get) => {
  const themeLayers = get(activeThemeLayersAtom);
  // Read so a change re-runs this effect and reshapes the layers on the map.
  const heritageDetails = get(heritageDetailsAtom);
  const heritageRender = get(heritageRenderAtom);
  const heritageOpacity = get(heritageOpacityAtom);
  const heritageHidden = get(heritageHiddenAtom);
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
      forgetReadingsFrom(`theme.${layerName}`);
    }
    removeFromUrlListParameter('themeLayers', layerName);
  });

  // Reshape whatever is on the map now, including the layers just added.
  map
    .getLayers()
    .getArray()
    .forEach((layer) => {
      const id = layer.get('id');
      if (typeof id !== 'string' || !id.startsWith('theme.')) return;
      layer.setOpacity(heritageOpacity);

      const layerName = id.substring(6) as ThemeLayerName;
      const params = paramsFor(layerName, heritageDetails, heritageRender);
      // kulturminner2 with no register ticked can only answer with a
      // transparent tile, so hide rather than request one. Hidden, not removed:
      // the tile cache survives and featureInfoService's `isRendering`
      // (`Layer#isVisible`) stops a click asking RA about an unseen register.
      const empty = layerName === RESHAPEABLE_THEME_LAYER && params === null;
      layer.setVisible(!heritageHidden && !empty);
      if (!params) return;

      const source = (layer as { getSource?: () => unknown }).getSource?.();
      if (!isWmsSource(source)) return;
      const current = source.getParams();
      // updateParams invalidates the tile cache and re-requests the screen.
      if (current.LAYERS === params.LAYERS && current.STYLES === params.STYLES)
        return;
      source.updateParams(params);
    });

  // The blind is over every source at once, and a card describing a register
  // nobody can see is a reading of an empty map. Not the same for a reshape: the
  // registers and the render change what is drawn, but what the reading named is
  // still recorded there, and clearing it would punish a reader for adjusting
  // the picture while reading a card.
  if (heritageHidden) {
    store.set(heritageTipAtom, null);
    store.set(heritagePopupAtom, null);
  }

  writeHeritageUrlParameters(heritageDetails, heritageRender, heritageOpacity);
});

type WmsSource = {
  getParams: () => Record<string, unknown>;
  updateParams: (params: Record<string, unknown>) => void;
};

const isWmsSource = (source: unknown): source is WmsSource =>
  typeof (source as WmsSource | null)?.updateParams === 'function' &&
  typeof (source as WmsSource | null)?.getParams === 'function';
