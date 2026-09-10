import { atom, getDefaultStore } from 'jotai';
import { atomEffect } from 'jotai-effect';
import {
  getUrlParameter,
  removeUrlParameter,
  setUrlParameter,
} from '../../../../shared/utils/urlUtils';
import { mapAtom } from '../../../atoms';
import { BackgroundLayerName, WMTSLayerName } from '../../backgroundLayers';
import { activeFlyfotoProjectAtom } from './flyfotoBackground';
import {
  activeLidarModelAtom,
  activeLidarProjectAtom,
  activeLidarStyleAtom,
  effectiveLidarStyle,
} from './lidarProjects';
import { buildStack, LIDAR_LAYERS, resolveStack } from './stack';
import { clearBackgroundLayer, swapBackgroundLayers } from './utils';

// Startup values the URL param may name directly. `lidarProject` and
// `flyfotoProject` are excluded because their concrete acquisition lives in
// an atom that starts null on a fresh visit — leaving the app on either one
// with nothing selected renders nothing.
const VALID_STARTUP_LAYERS = new Set<BackgroundLayerName>([
  'topo',
  'lidarHillshade',
  'flyfoto',
  'empty',
]);

const getDefaultBackgroundLayer = (): BackgroundLayerName => {
  const layerNameFromUrl = getUrlParameter(
    'backgroundLayer',
  ) as BackgroundLayerName | null;
  if (layerNameFromUrl && VALID_STARTUP_LAYERS.has(layerNameFromUrl)) {
    return layerNameFromUrl;
  }
  return 'topo';
};

export const backgroundLayerCapabilitiesCacheAtom = atom<
  Partial<Record<WMTSLayerName, string>>
>({});

export const backgroundLayerAtom = atom<BackgroundLayerName>(
  getDefaultBackgroundLayer(),
);

// Hybrid mode: the LiDAR relief with Kartverket's transparent
// roads/railways/place-names overlay on top, so you can tell what
// you're looking at without leaving the terrain. A modifier on the
// background rather than a background of its own — it only has meaning
// over a LiDAR layer, and toggling it doesn't disturb which dataset or
// style is selected underneath.
export const hybridOverlayAtom = atom<boolean>(
  getUrlParameter('hybrid') === 'true',
);

// Which run of the effect below is the current one. The effect builds
// its stack asynchronously — a WMTS base still needs its capabilities
// fetched the first time — while W/S and A/D fire the effect faster than
// that round trip. Without this an earlier run could resolve last and
// install a stack the user has already cycled past, along with its URL
// parameters. Bumped before any of the early returns so switching to the
// empty background invalidates an in-flight build too.
let swapGeneration = 0;

export const backgroundLayerAtomEffect = atomEffect((get) => {
  const generation = ++swapGeneration;
  const layerName = get(backgroundLayerAtom);
  // Depend on the active lidar project + style so switching either while
  // a LiDAR layer is the background rebuilds the WMS layer.
  const activeLidarProject = get(activeLidarProjectAtom);
  const activeLidarStyle = get(activeLidarStyleAtom);
  const activeLidarModel = get(activeLidarModelAtom);
  // Same for the flyfoto acquisition: picking another year while
  // 'flyfotoProject' is the background rebuilds its mosaicRule.
  const activeFlyfotoProject = get(activeFlyfotoProjectAtom);
  const hybridOverlay = get(hybridOverlayAtom);

  if (layerName === 'empty') {
    clearBackgroundLayer();
    setUrlParameter('backgroundLayer', 'empty');
    return;
  }

  const stack = resolveStack(layerName, {
    lidarProject: activeLidarProject,
    // DOM publishes one style, so the model has the last word — and the
    // user's DTM pick stays in the atom, waiting for them to switch back.
    lidarStyle: effectiveLidarStyle(activeLidarStyle, activeLidarModel),
    lidarModel: activeLidarModel,
    flyfotoProject: activeFlyfotoProject,
    hybridOverlay,
  });

  if (!stack) {
    if (layerName === 'lidarProject' || layerName === 'flyfotoProject') {
      // Nothing picked out of the archive yet — nothing to render, and
      // nothing wrong either, so no warning.
      return;
    }
    console.warn(`No layer config found for layer name: ${layerName}`);
    return;
  }

  const effect = async () => {
    try {
      const store = getDefaultStore();
      const map = store.get(mapAtom);
      const projection = map.getView().getProjection().getCode();

      const built = await buildStack(stack, projection);

      // A newer run started while this one was building. Everything from
      // here on mutates shared state — the layer collection, the URL —
      // so it has to be the last word or not happen at all.
      if (generation !== swapGeneration) return;
      if (!built) return;

      // Always set opacity explicitly: any of these may be a reused
      // layer still carrying the fade from an earlier swap.
      for (const { layer, opacity } of [...built.under, ...built.over]) {
        layer.setOpacity(opacity);
      }

      swapBackgroundLayers(
        built.under.map((e) => e.layer),
        built.over.map((e) => e.layer),
      );
      setUrlParameter('backgroundLayer', layerName);
      // Keyed on what's actually in the stack, not on the atoms: a
      // shared URL should reproduce what's on screen.
      if (stack.hybrid) setUrlParameter('hybrid', true);
      else removeUrlParameter('hybrid');
      if (LIDAR_LAYERS.has(layerName) && activeLidarModel === 'dom') {
        setUrlParameter('lidarModel', 'dom');
      } else {
        removeUrlParameter('lidarModel');
      }

      const moveToExtent = stack.over[0].config.moveToExtent;
      if (moveToExtent) {
        map.getView().fit(moveToExtent, { duration: 200 });
      }
    } catch (error) {
      console.error(
        `Error fetching capabilities for layer ${layerName}:`,
        error,
      );
    }
  };

  effect();
});
