import { atom, getDefaultStore } from 'jotai';
import { atomEffect } from 'jotai-effect';
import type OlMap from 'ol/Map';
import {
  getUrlParameter,
  removeUrlParameter,
  setUrlParameter,
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

const NO_THEME_LAYERS: ReadonlySet<ThemeLayerName> = new Set();

export const RESHAPEABLE_THEME_LAYER: ThemeLayerName = 'heritageSites';

const THEME_LAYER_ORDER: readonly ThemeLayerName[] = [
  'heritageSites',
  'culturalEnvironments',
  'sefrakBuildings',
  'protectedBuildings',
  'userReportedHeritage',
];

const DEFAULT_THEME_LAYERS: readonly ThemeLayerName[] = ['heritageSites'];

export const readThemeLayers = (): Set<ThemeLayerName> => {
  const fromUrl = getUrlParameter('themeLayers');
  if (fromUrl === null) return new Set(DEFAULT_THEME_LAYERS);
  return new Set(
    fromUrl
      .split(',')
      .filter((name): name is ThemeLayerName =>
        (THEME_LAYER_ORDER as readonly string[]).includes(name),
      ),
  );
};

const writeThemeLayersUrlParameter = (
  layers: ReadonlySet<ThemeLayerName>,
): void => {
  const isDefault =
    layers.size === DEFAULT_THEME_LAYERS.length &&
    DEFAULT_THEME_LAYERS.every((name) => layers.has(name));
  if (isDefault) {
    removeUrlParameter('themeLayers');
  } else {
    setUrlParameter(
      'themeLayers',
      THEME_LAYER_ORDER.filter((name) => layers.has(name)).join(','),
    );
  }
};

const themeLayersOnMap = (map: OlMap): Set<ThemeLayerName> =>
  new Set(
    map
      .getLayers()
      .getArray()
      .map((layer) => layer.get('id'))
      .filter((id): id is string => typeof id === 'string')
      .filter((id) => id.startsWith('theme.'))
      .map((id) => id.substring(6) as ThemeLayerName),
  );

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

const syncThemeLayers = (
  map: OlMap,
  {
    themeLayers,
    heritageDetails,
    heritageRender,
    heritageOpacity,
    heritageHidden,
  }: ThemeLayerSettings,
): { onMap: Set<ThemeLayerName>; removed: ThemeLayerName[] } => {
  const mapProjection = map.getView().getProjection().getCode();
  const themelayersActive = themeLayersOnMap(map);

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
  });

  themeLayersToRemove.forEach((layerName) => {
    const layer = map
      .getLayers()
      .getArray()
      .find((layer) => layer.get('id') === `theme.${layerName}`);
    if (layer) retireLayer(map, layer);
  });

  map
    .getLayers()
    .getArray()
    .forEach((layer) => {
      const id = layer.get('id');
      if (typeof id !== 'string' || !id.startsWith('theme.')) return;
      layer.setOpacity(heritageOpacity);

      const layerName = id.substring(6) as ThemeLayerName;
      const params = paramsFor(layerName, heritageDetails, heritageRender);

      const empty = layerName === RESHAPEABLE_THEME_LAYER && params === null;
      layer.setVisible(!heritageHidden && !empty);
      if (!params) return;

      const source = (layer as { getSource?: () => unknown }).getSource?.();
      if (!isWmsSource(source)) return;
      const current = source.getParams();

      if (current.LAYERS === params.LAYERS && current.STYLES === params.STYLES)
        return;
      source.updateParams(params);
    });

  return { onMap: themeLayersOnMap(map), removed: themeLayersToRemove };
};

export const themeLayerEffect = atomEffect((get) => {

  const settings: ThemeLayerSettings = {
    themeLayers: get(activeThemeLayersAtom),
    heritageDetails: get(heritageDetailsAtom),
    heritageRender: get(heritageRenderAtom),
    heritageOpacity: get(heritageOpacityAtom),
    heritageHidden: get(heritageHiddenAtom),
  };
  const mode = get(viewModeAtom);
  const store = getDefaultStore();

  const { onMap, removed } = syncThemeLayers(store.get(mapAtom), settings);

  const pane = mode === 'split' ? getSplitMap() : peekSplitMap();
  if (pane) {
    syncThemeLayers(pane, {
      ...settings,
      themeLayers: mode === 'split' ? settings.themeLayers : NO_THEME_LAYERS,
    });
  }

  writeThemeLayersUrlParameter(onMap);
  for (const layerName of removed) {
    forgetReadingsFrom(`theme.${layerName}`);
  }

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
