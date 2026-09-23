import { atom, getDefaultStore } from 'jotai';
import { atomEffect } from 'jotai-effect';
import {
  getUrlParameter,
  removeUrlParameter,
  setUrlParameter,
} from '../../../../shared/utils/urlUtils';
import { mapAtom } from '../../../atoms';
import { acrossHalves, halved } from '../../../compare/halves';
import { BackgroundLayerName } from '../../backgroundLayers';
import { activeCvatAcquisitionHalves } from './cvatGround';
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
// `flyfotoProject`: their acquisition atom starts null and only the user can
// fill it, so a cold load into either would render nothing indefinitely.
// `lidarCvat` is in it because Automatisk derives its flight on every load.
const VALID_STARTUP_LAYERS = new Set<BackgroundLayerName>([
  'topo',
  'topograatone',
  'toporaster',
  'sjokartraster',
  'amtskart',
  'lidarHillshade',
  'lidarCvat',
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
  return 'lidarHillshade';
};

// Keyed by URL rather than layer name: Kartverket's cache publishes all four
// Kart variants in one capabilities document.
export const backgroundLayerCapabilitiesCacheAtom = atom<
  Record<string, string>
>({});

export const backgroundLayerHalves = halved<BackgroundLayerName>(
  getDefaultBackgroundLayer(),
);

export const liveBackgroundLayersAtom = acrossHalves(backgroundLayerHalves);

export const hybridOverlayHalves = halved<boolean>(
  getUrlParameter('hybrid') === 'true',
);

export const hybridContoursHalves = halved<boolean>(
  getUrlParameter('contours') === 'true',
);

// The build awaits and key-repeat outruns it, so a stale run must not install a
// stack already cycled past.
let swapGeneration = 0;

export const backgroundLayerAtomEffect = atomEffect((get) => {
  const generation = ++swapGeneration;
  // The A half throughout; the B half is `compareLayerAtomEffect`'s.
  const layerName = get(backgroundLayerHalves.a);
  // Read for the subscription: any of these changing rebuilds the stack.
  const activeLidarProject = get(activeLidarProjectHalves.a);
  const activeLidarStyle = get(activeLidarStyleHalves.a);
  const activeLidarModel = get(activeLidarModelHalves.a);
  const activeCvatAcquisition = get(activeCvatAcquisitionHalves.a);
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
    cvatAcquisition: activeCvatAcquisition,
    // DOM publishes one style, so the model has the last word.
    lidarStyle: effectiveLidarStyle(activeLidarStyle, activeLidarModel),
    lidarModel: activeLidarModel,
    flyfotoProject: activeFlyfotoProject,
    hybridOverlay,
    hybridContours,
  });

  if (!stack) {
    if (
      layerName === 'lidarProject' ||
      layerName === 'flyfotoProject' ||
      layerName === 'lidarCvat'
    ) {
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

      // A reused layer still carries an earlier swap's fade and z-index.
      for (const { layer, opacity, zIndex } of [
        ...built.under,
        ...built.over,
      ]) {
        layer.setOpacity(opacity);
        layer.setZIndex(zIndex);
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
