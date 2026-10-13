import { atom, type Getter, getDefaultStore, type Setter } from 'jotai';
import { atomEffect } from 'jotai-effect';
import { serviceOn } from '../../services';
import {
  getUrlParameter,
  removeUrlParameter,
  setUrlParameter,
} from '../../shared/utils/urlUtils';
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
  KART_VARIANTS,
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
  setCurtainSplit,
} from './compareLayers';
import { seedHalfB, type ViewMode, viewModeAtom } from './halves';

export const compareSplitAtom = atom(0.5);

export const MIN_SPLIT = 0.05;
export const MAX_SPLIT = 0.95;

export const clampSplit = (fraction: number): number =>
  Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, fraction));

export const DEFAULT_SPLIT_PERCENT = 50;

const contrastingGround = (a: BackgroundLayerName): 'kart' | 'lidar' =>
  isKartVariant(a) ? 'lidar' : 'kart';

const enterGroundB = (ground: 'kart' | 'lidar', get: Getter, set: Setter) => {
  if (ground === 'kart') {
    set(backgroundLayerHalves.b, get(kartVariantHalves.b));
    return;
  }

  set(activeLidarStyleHalves.b, DEFAULT_LIDAR_PROJECT_STYLE);
  set(backgroundLayerHalves.b, 'lidarHillshade');
};

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

const LINKABLE_GROUNDS_B = new Set<BackgroundLayerName>([
  ...KART_VARIANTS,
  'lidarHillshade',

  ...(serviceOn('flyfoto') ? (['flyfoto'] as BackgroundLayerName[]) : []),
]);

const DEGRADES_TO = new Map<string, BackgroundLayerName>([
  ['lidarProject', 'lidarHillshade'],
  ['lidarCvat', 'lidarHillshade'],
  ['flyfotoProject', 'flyfoto'],
]);

const linkableGroundB = (name: string): BackgroundLayerName | null => {
  const ground = DEGRADES_TO.get(name) ?? (name as BackgroundLayerName);
  return LINKABLE_GROUNDS_B.has(ground) ? ground : null;
};

const enterNamedGroundB = (
  name: BackgroundLayerName,
  get: Getter,
  set: Setter,
) => {
  if (isKartVariant(name)) {
    set(kartVariantHalves.b, name);
    set(backgroundLayerHalves.b, name);
    return;
  }
  if (name === 'lidarHillshade') {
    enterGroundB('lidar', get, set);
    return;
  }
  set(backgroundLayerHalves.b, name);
};

const readLinkedViewMode = (): ViewMode | null => {
  const raw = getUrlParameter('viewMode');
  return raw === 'curtain' || raw === 'split' ? raw : null;
};

const readLinkedSplit = (): number | null => {
  const raw = getUrlParameter('curtain');
  if (!raw) return null;
  const percent = Number(raw);
  return Number.isFinite(percent) ? clampSplit(percent / 100) : null;
};

const linkedViewMode = readLinkedViewMode();
const linkedGroundB = linkableGroundB(
  getUrlParameter('backgroundLayerB') ?? '',
);
const linkedSplit = readLinkedSplit();

let compareRestored = false;

export const restoreCompareFromUrlAtom = atom(null, (get, set) => {
  if (compareRestored) return;
  compareRestored = true;
  if (!linkedViewMode) return;

  if (linkedSplit != null) {
    setCurtainSplit(linkedSplit);
    set(compareSplitAtom, linkedSplit);
  }
  set(selectViewModeAtom, linkedViewMode);
  if (linkedGroundB) enterNamedGroundB(linkedGroundB, get, set);
});

export const compareUrlAtomEffect = atomEffect((get) => {
  const mode = get(viewModeAtom);
  const ground = linkableGroundB(get(backgroundLayerHalves.b));

  if (mode === 'single') {
    removeUrlParameter('viewMode');
    removeUrlParameter('backgroundLayerB');
    removeUrlParameter('curtain');
    return;
  }

  setUrlParameter('viewMode', mode);
  if (ground) setUrlParameter('backgroundLayerB', ground);
  else removeUrlParameter('backgroundLayerB');

  if (mode === 'split') removeUrlParameter('curtain');
});

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

  if (mode === 'single' || layerName === 'empty') {
    clearCompareLayers();
    return;
  }

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
