import { atom, type Getter, getDefaultStore, type Setter } from 'jotai';
import { atomEffect } from 'jotai-effect';
import { mapAtom } from '../atoms';
import { BackgroundLayerName } from '../layers/backgroundLayers';
import {
  backgroundLayerHalves,
  hybridContoursHalves,
  hybridOverlayHalves,
} from '../layers/config/backgroundLayers/atoms';
import { activeCvatAcquisitionHalves } from '../layers/config/backgroundLayers/cvatGround';
import { activeFlyfotoProjectHalves } from '../layers/config/backgroundLayers/flyfotoBackground';
import {
  isKartVariant,
  kartVariantHalves,
} from '../layers/config/backgroundLayers/kartVariants';
import { lidarAutoDatasetHalves } from '../layers/config/backgroundLayers/lidarAuto';
import {
  activeLidarModelHalves,
  activeLidarProjectHalves,
  activeLidarStyleHalves,
  DEFAULT_LIDAR_PROJECT_STYLE,
  effectiveLidarStyle,
} from '../layers/config/backgroundLayers/lidarProjects';
import {
  buildStack,
  resolveStack,
} from '../layers/config/backgroundLayers/stack';
import {
  clearCompareLayers,
  clearCompareLayersExcept,
  compareHostFor,
  installCompareLayers,
} from './compareLayers';
import { seedHalfB, type ViewMode, viewModeAtom } from './halves';

/** Where the curtain edge sits, as a fraction of the map width. */
export const compareSplitAtom = atom(0.5);

const contrastingGround = (a: BackgroundLayerName): 'kart' | 'lidar' =>
  isKartVariant(a) ? 'lidar' : 'kart';

// Repeats the arms' entry rules: B is seeded before React re-renders with the
// second ground section mounted.
const enterGroundB = (ground: 'kart' | 'lidar', get: Getter, set: Setter) => {
  if (ground === 'kart') {
    set(backgroundLayerHalves.b, get(kartVariantHalves.b));
    return;
  }
  // `enterLidar` with Automatisk off: the national mosaic, not the held flight,
  // which need not cover this screen.
  set(activeLidarStyleHalves.b, DEFAULT_LIDAR_PROJECT_STYLE);
  set(backgroundLayerHalves.b, 'lidarHillshade');
};

/** B is seeded from A only on the way out of `single`; moving between the
 *  curtain and the split keeps B where the reader put it. */
export const selectViewModeAtom = atom(null, (get, set, mode: ViewMode) => {
  const previous = get(viewModeAtom);
  if (mode === previous) return;
  if (previous === 'single' && mode !== 'single') {
    seedHalfB(get, set);
    set(lidarAutoDatasetHalves.b, false);
    enterGroundB(contrastingGround(get(backgroundLayerHalves.a)), get, set);
  }
  set(viewModeAtom, mode);
});

// The build awaits, so an earlier run resolving last must not install.
let compareGeneration = 0;

export const compareLayerAtomEffect = atomEffect((get) => {
  const mode = get(viewModeAtom);
  const layerName = get(backgroundLayerHalves.b);
  const hybridOverlay = get(hybridOverlayHalves.b);
  const hybridContours = get(hybridContoursHalves.b);
  const lidarProject = get(activeLidarProjectHalves.b);
  const lidarStyle = get(activeLidarStyleHalves.b);
  const lidarModel = get(activeLidarModelHalves.b);
  const flyfotoProject = get(activeFlyfotoProjectHalves.b);
  const cvatAcquisition = get(activeCvatAcquisitionHalves.b);

  const generation = ++compareGeneration;

  // 'empty' is not offered as a choice but is reachable from ?backgroundLayer.
  if (mode === 'single' || layerName === 'empty') {
    clearCompareLayers();
    return;
  }

  // Swept here and not in the install: the build below can end without
  // installing and leave the other host drawing.
  const host = compareHostFor(mode);
  clearCompareLayersExcept(host);
  const clip = mode === 'curtain';

  const stack = resolveStack(layerName, {
    lidarProject,
    cvatAcquisition,
    lidarStyle: effectiveLidarStyle(lidarStyle, lidarModel),
    lidarModel,
    flyfotoProject,
    hybridOverlay,
    hybridContours,
  });
  if (!stack) return;

  const install = async () => {
    try {
      const projection = getDefaultStore()
        .get(mapAtom)
        .getView()
        .getProjection()
        .getCode();
      const built = await buildStack(stack, projection, 'cmp', host);
      if (generation !== compareGeneration) return;
      if (!built) return;

      // Opacity only: `installCompareLayers` sets the z-index itself.
      for (const { layer, opacity } of [...built.under, ...built.over]) {
        layer.setOpacity(opacity);
      }
      installCompareLayers(
        built.under.map((e) => e.layer),
        built.over.map((e) => e.layer),
        { host, clip },
      );
    } catch (error) {
      console.error('[compare] failed to build the B stack', error);
    }
  };

  install();
});
