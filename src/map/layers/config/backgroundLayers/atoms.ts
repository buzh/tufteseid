import { atom, getDefaultStore } from 'jotai';
import { atomEffect } from 'jotai-effect';
import {
  getUrlParameter,
  removeUrlParameter,
  setUrlParameter,
} from '../../../../shared/utils/urlUtils';
import { mapAtom } from '../../../atoms';
import { halved } from '../../../compare/halves';
import { BackgroundLayerName } from '../../backgroundLayers';
import { activeFlyfotoProjectHalves } from './flyfotoBackground';
import {
  activeLidarModelHalves,
  activeLidarProjectHalves,
  activeLidarStyleHalves,
  effectiveLidarStyle,
} from './lidarProjects';
import { buildStack, LIDAR_LAYERS, resolveStack } from './stack';
import { clearBackgroundLayer, swapBackgroundLayers } from './utils';

// Startup values the URL parameter may name. Not `lidarProject` or
// `flyfotoProject`: their acquisition atom starts null, so a cold load into
// either renders nothing.
const VALID_STARTUP_LAYERS = new Set<BackgroundLayerName>([
  'topo',
  'topograatone',
  'toporaster',
  'sjokartraster',
  'amtskart',
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
  // LiDAR relief is what this is for; Kart is a step away, not the arrival.
  return 'lidarHillshade';
};

// Fetched WMTS capabilities, keyed by URL rather than layer name: Kartverket's
// cache publishes all four Kart variants in one 35 kB document.
export const backgroundLayerCapabilitiesCacheAtom = atom<
  Record<string, string>
>({});

// Two halves and a facade (src/map/compare/halves.ts): `.a` is the ordinary
// background, `.b` the curtain's right side, and the facade the focused one.
export const backgroundLayerHalves = halved<BackgroundLayerName>(
  getDefaultBackgroundLayer(),
);
export const backgroundLayerAtom = backgroundLayerHalves.focused;

// Kartverket's transparent roads/railways/place-names overlay over the relief.
// A modifier, not a background, so toggling leaves the dataset underneath.
export const hybridOverlayHalves = halved<boolean>(
  getUrlParameter('hybrid') === 'true',
);
export const hybridOverlayAtom = hybridOverlayHalves.focused;

// Contours are two more group layers in that overlay's own GetMap.
export const hybridContoursHalves = halved<boolean>(
  getUrlParameter('contours') === 'true',
);
export const hybridContoursAtom = hybridContoursHalves.focused;

// Which run of the effect below is current: the build awaits and key-repeat
// outruns it, so a stale run must not install a stack already cycled past.
let swapGeneration = 0;

export const backgroundLayerAtomEffect = atomEffect((get) => {
  const generation = ++swapGeneration;
  // The A half throughout, never the facade: the ribbon pointing at the
  // curtain's B half must not rebuild the map's own background.
  const layerName = get(backgroundLayerHalves.a);
  // Read so switching project, style or model rebuilds the LiDAR WMS layer.
  const activeLidarProject = get(activeLidarProjectHalves.a);
  const activeLidarStyle = get(activeLidarStyleHalves.a);
  const activeLidarModel = get(activeLidarModelHalves.a);
  // Same for the flyfoto acquisition: another year rebuilds its mosaicRule.
  const activeFlyfotoProject = get(activeFlyfotoProjectHalves.a);
  const hybridOverlay = get(hybridOverlayHalves.a);
  const hybridContours = get(hybridContoursHalves.a);

  if (layerName === 'empty') {
    clearBackgroundLayer();
    setUrlParameter('backgroundLayer', 'empty');
    return;
  }

  const stack = resolveStack(layerName, {
    lidarProject: activeLidarProject,
    // DOM publishes one style, so the model has the last word.
    lidarStyle: effectiveLidarStyle(activeLidarStyle, activeLidarModel),
    lidarModel: activeLidarModel,
    flyfotoProject: activeFlyfotoProject,
    hybridOverlay,
    hybridContours,
  });

  if (!stack) {
    if (layerName === 'lidarProject' || layerName === 'flyfotoProject') {
      // Nothing picked out of the archive yet: not an error.
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

      // Everything below mutates the shared layer collection and the URL.
      if (generation !== swapGeneration) return;
      if (!built) return;

      // Always explicit: a reused layer still carries an earlier swap's fade.
      for (const { layer, opacity } of [...built.under, ...built.over]) {
        layer.setOpacity(opacity);
      }

      swapBackgroundLayers(
        built.under.map((e) => e.layer),
        built.over.map((e) => e.layer),
      );
      setUrlParameter('backgroundLayer', layerName);
      // Keyed on the stack, not the atoms, so a shared URL reproduces the view.
      if (stack.hybrid) setUrlParameter('hybrid', true);
      else removeUrlParameter('hybrid');
      if (stack.contours) setUrlParameter('contours', true);
      else removeUrlParameter('contours');
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
