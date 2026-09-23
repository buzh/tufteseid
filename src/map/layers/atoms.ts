import { atom, getDefaultStore } from 'jotai';
import { atomEffect } from 'jotai-effect';
import type OlMap from 'ol/Map';
import {
  addToUrlListParameter,
  removeFromUrlListParameter,
} from '../../shared/utils/urlUtils';
import { mapAtom } from '../atoms';
import { viewModeAtom } from '../compare/halves';
import { getSplitMap, peekSplitMap } from '../compare/splitMap';
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
import { retireLayer, takePooledLayer } from './layerPool';
import { getThemeLayerById, themeLayerConfig } from './themeLayerConfigApi';
import {
  createThemeLayerFromConfig,
  ThemeLayerName,
  themeLayerPoolKey,
} from './themeWMS';

export const activeThemeLayersAtom = atom<Set<ThemeLayerName>>(new Set([]));

// Module-level for a stable identity: a fresh `new Set()` per read re-runs
// every effect below.
const NO_THEME_LAYERS: ReadonlySet<ThemeLayerName> = new Set();

// The one theme layer whose WMS request can be reshaped; the other four RA
// services publish a single style each.
export const RESHAPEABLE_THEME_LAYER: ThemeLayerName = 'heritageSites';

// Drops one source's features rather than the whole reading, so a card stands
// when one of several ticked registers is turned off underneath it.
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

type ThemeLayerSettings = {
  themeLayers: ReadonlySet<ThemeLayerName>;
  heritageDetails: ReadonlySet<HeritageDetail>;
  heritageRender: HeritageRender;
  heritageOpacity: number;
  heritageHidden: boolean;
};

// Takes a map rather than reading `mapAtom`: an OL layer belongs to one map at
// a time, so the split view's two panes each get their own instances. Touches
// nothing outside the map — the URL and the open readings are the caller's.
const syncThemeLayers = (
  map: OlMap,
  {
    themeLayers,
    heritageDetails,
    heritageRender,
    heritageOpacity,
    heritageHidden,
  }: ThemeLayerSettings,
): { added: ThemeLayerName[]; removed: ThemeLayerName[] } => {
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

  // Only the ones that reached the map: a skipped layer reported as added
  // would go into the URL and survive every reload.
  const added: ThemeLayerName[] = [];

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
    // A pooled layer still holds its tiles; the reshape below corrects its
    // registers if they moved on while it was off the map.
    const layerToAdd =
      takePooledLayer(themeLayerPoolKey(layerName, mapProjection)) ??
      createThemeLayerFromConfig(
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
    added.push(layerName);
  });

  themeLayersToRemove.forEach((layerName) => {
    const layer = map
      .getLayers()
      .getArray()
      .find((layer) => layer.get('id') === `theme.${layerName}`);
    if (layer) retireLayer(map, layer);
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
      // With no register ticked the source can only answer a transparent tile.
      // Hidden rather than removed keeps the tile cache, and featureInfo's
      // `isRendering` stops a click asking RA about an unseen register.
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

  return { added, removed: themeLayersToRemove };
};

export const themeLayerEffect = atomEffect((get) => {
  // Read for the subscription: any of these changing reshapes the map.
  const settings: ThemeLayerSettings = {
    themeLayers: get(activeThemeLayersAtom),
    heritageDetails: get(heritageDetailsAtom),
    heritageRender: get(heritageRenderAtom),
    heritageOpacity: get(heritageOpacityAtom),
    heritageHidden: get(heritageHiddenAtom),
  };
  const mode = get(viewModeAtom);
  const store = getDefaultStore();

  const { added, removed } = syncThemeLayers(store.get(mapAtom), settings);

  // A ticked register draws over both panes of a split. Created here rather
  // than waited for: this effect mounts ahead of the one that builds the B
  // ground, so the new pane would otherwise stay bare until the next change.
  const pane = mode === 'split' ? getSplitMap() : peekSplitMap();
  if (pane) {
    syncThemeLayers(pane, {
      ...settings,
      themeLayers: mode === 'split' ? settings.themeLayers : NO_THEME_LAYERS,
    });
  }

  // Off the main map's result alone; the second pane is a mirror.
  for (const layerName of added) {
    addToUrlListParameter('themeLayers', layerName);
  }
  for (const layerName of removed) {
    removeFromUrlListParameter('themeLayers', layerName);
    forgetReadingsFrom(`theme.${layerName}`);
  }

  // Only the blind clears the readings: what a reshape hides is still recorded.
  if (settings.heritageHidden) {
    store.set(heritageTipAtom, null);
    store.set(heritagePopupAtom, null);
  }

  writeHeritageUrlParameters(
    settings.heritageDetails,
    settings.heritageRender,
    settings.heritageOpacity,
  );
});

type WmsSource = {
  getParams: () => Record<string, unknown>;
  updateParams: (params: Record<string, unknown>) => void;
};

const isWmsSource = (source: unknown): source is WmsSource =>
  typeof (source as WmsSource | null)?.updateParams === 'function' &&
  typeof (source as WmsSource | null)?.getParams === 'function';
