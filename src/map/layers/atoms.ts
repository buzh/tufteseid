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

type ThemeLayerSettings = {
  themeLayers: ReadonlySet<ThemeLayerName>;
  heritageDetails: ReadonlySet<HeritageDetail>;
  heritageRender: HeritageRender;
  heritageOpacity: number;
  heritageHidden: boolean;
};

/**
 * Bring one map's `theme.` layers in line with the settings, and say what
 * changed. Takes a map rather than reading `mapAtom` because the split view has
 * two of them and an OL layer belongs to one map at a time: each gets its own
 * instances, built from the same config.
 *
 * Nothing outside the map is touched in here — the URL and the open readings
 * follow the main map alone, and are the caller's to write.
 */
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

  // The ones that actually reached the map. A layer with no config, or none the
  // map's projection can be served in, warns and is skipped — and must not be
  // reported as added, or the caller would write a register that has never
  // drawn into the URL, where it would survive every reload.
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
    // A register ticked off a moment ago still has its tiles: take that layer
    // back rather than asking RA's MapServer — the slowest origin in the app —
    // for the same screen again. The reshape below corrects its registers if
    // they moved on while it was off the map.
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

  return { added, removed: themeLayersToRemove };
};

export const themeLayerEffect = atomEffect((get) => {
  // Read so a change re-runs this effect and reshapes the layers on the map.
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

  // The registers belong to the reading, not to a half: a ticked register draws
  // over both panes of a split, so the second map gets the same set. Created
  // here when the split is the view, because this effect is mounted ahead of
  // the one that builds the B ground and would otherwise leave the new pane
  // bare until the next change. Outside the split the pane is emptied rather
  // than left holding a set that will have moved on by the time it is shown
  // again.
  const pane = mode === 'split' ? getSplitMap() : peekSplitMap();
  if (pane) {
    syncThemeLayers(pane, {
      ...settings,
      themeLayers: mode === 'split' ? settings.themeLayers : NO_THEME_LAYERS,
    });
  }

  // Off the main map's result alone. The URL says what the reader ticked, and a
  // reading is what a layer answered — a mirror in the second pane is neither.
  for (const layerName of added) {
    addToUrlListParameter('themeLayers', layerName);
  }
  for (const layerName of removed) {
    removeFromUrlListParameter('themeLayers', layerName);
    forgetReadingsFrom(`theme.${layerName}`);
  }

  // The blind is over every source at once, and a card describing a register
  // nobody can see is a reading of an empty map. Not the same for a reshape: the
  // registers and the render change what is drawn, but what the reading named is
  // still recorded there, and clearing it would punish a reader for adjusting
  // the picture while reading a card.
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
