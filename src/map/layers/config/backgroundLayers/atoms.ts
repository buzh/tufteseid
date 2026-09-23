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
// fill it, so a cold load into either renders nothing, indefinitely.
// `lidarCvat` is in it because the flight under it is *derived*: Automatisk is
// on at every cold load, so the footprint ranking names the flight the view is
// over as soon as it lands, and `resolveLidarStyle` puts the render back on our
// cache where the store holds it — so a shared link to a view read on the
// cached ground opens on it.
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
  // LiDAR relief is what this is for; Kart is a step away, not the arrival.
  return 'lidarHillshade';
};

// Fetched WMTS capabilities, keyed by URL rather than layer name: Kartverket's
// cache publishes all four Kart variants in one 35 kB document.
export const backgroundLayerCapabilitiesCacheAtom = atom<
  Record<string, string>
>({});

// Two halves (src/map/compare/halves.ts): `.a` is the left of the screen and
// the whole of it while one ground is up, `.b` the right of a two-ground view.
// A surface writes the half it belongs to; nothing writes "the current one".
export const backgroundLayerHalves = halved<BackgroundLayerName>(
  getDefaultBackgroundLayer(),
);

/** Every ground on the screen — one, or both while two are up. What a surface
 *  belonging to the map rather than to a half asks. */
export const liveBackgroundLayersAtom = acrossHalves(backgroundLayerHalves);

// Kartverket's transparent roads/railways/place-names overlay over the relief.
// A modifier, not a background, so toggling leaves the dataset underneath.
export const hybridOverlayHalves = halved<boolean>(
  getUrlParameter('hybrid') === 'true',
);

// Contours are two more group layers in that overlay's own GetMap.
export const hybridContoursHalves = halved<boolean>(
  getUrlParameter('contours') === 'true',
);

// Which run of the effect below is current: the build awaits and key-repeat
// outruns it, so a stale run must not install a stack already cycled past.
let swapGeneration = 0;

export const backgroundLayerAtomEffect = atomEffect((get) => {
  const generation = ++swapGeneration;
  // The A half throughout: this is the left of the screen, and the whole of it
  // while one ground is up. The B half is `compareLayerAtomEffect`'s.
  const layerName = get(backgroundLayerHalves.a);
  // Read so switching project, style or model rebuilds the LiDAR WMS layer.
  const activeLidarProject = get(activeLidarProjectHalves.a);
  const activeLidarStyle = get(activeLidarStyleHalves.a);
  const activeLidarModel = get(activeLidarModelHalves.a);
  // Same for the cached ground: another acquisition is another envelope and
  // another set of levels, so the XYZ layer is rebuilt rather than reused.
  const activeCvatAcquisition = get(activeCvatAcquisitionHalves.a);
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
      // Waiting on the manifest and the footprint ranking, a tick after a cold
      // load into the cached ground. Also not an error.
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

      // Always explicit: a reused layer still carries an earlier swap's fade,
      // and its place in the z-order (the hybrid overlay rides above the
      // cached store's coverage hint; every other ground sits at 0).
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
