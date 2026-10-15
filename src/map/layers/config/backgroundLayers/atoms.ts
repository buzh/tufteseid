import { atom, getDefaultStore } from 'jotai';
import { atomEffect } from 'jotai-effect';
import { featureHeldNow } from '../../../../auth/features';
import { serviceOn } from '../../../../services';
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

const VALID_STARTUP_LAYERS = new Set<BackgroundLayerName>([
  'topo',
  'topograatone',
  'toporaster',
  'sjokartraster',
  'amtskart',
  'lidarHillshade',
  'lidarProject',
  'lidarCvat',
  'flyfoto',
  'empty',
]);

const availableToReader = (name: BackgroundLayerName): boolean => {
  if (name === 'flyfoto' || name === 'flyfotoProject') {
    return featureHeldNow('flyfoto');
  }
  if (name === 'lidarCvat') return serviceOn('cvat');
  return true;
};

const getDefaultBackgroundLayer = (): BackgroundLayerName => {
  const layerNameFromUrl = getUrlParameter(
    'backgroundLayer',
  ) as BackgroundLayerName | null;
  if (
    layerNameFromUrl &&
    VALID_STARTUP_LAYERS.has(layerNameFromUrl) &&
    availableToReader(layerNameFromUrl)
  ) {
    return layerNameFromUrl;
  }
  return 'lidarHillshade';
};

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

let swapGeneration = 0;

export const backgroundLayerAtomEffect = atomEffect((get) => {
  const generation = ++swapGeneration;
  const layerName = get(backgroundLayerHalves.a);
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

      if (generation !== swapGeneration) return;
      if (!built) return;

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
      if (stack.hybrid) setUrlParameter('hybrid', true);
      else removeUrlParameter('hybrid');
      if (stack.contours) setUrlParameter('contours', true);
      else removeUrlParameter('contours');
      if (LIDAR_LAYERS.has(layerName) && activeLidarModel === 'dom') {
        setUrlParameter('lidarModel', 'dom');
      } else {
        removeUrlParameter('lidarModel');
      }
      if (LIDAR_LAYERS.has(layerName)) {
        setUrlParameter('lidarRender', activeLidarStyle);
      } else {
        removeUrlParameter('lidarRender');
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
