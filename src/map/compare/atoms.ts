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

/** Where the curtain edge sits, as a fraction of the map width. */
export const compareSplitAtom = atom(0.5);

// Far enough from either edge that no drag or link can put the seam out of
// reach.
export const MIN_SPLIT = 0.05;
export const MAX_SPLIT = 0.95;

export const clampSplit = (fraction: number): number =>
  Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, fraction));

/** The seam the `curtain` parameter is absent for. */
export const DEFAULT_SPLIT_PERCENT = 50;

const contrastingGround = (a: BackgroundLayerName): 'kart' | 'lidar' =>
  isKartVariant(a) ? 'lidar' : 'kart';

// Repeats the arms' entry rules rather than calling them: B is seeded before
// the second ground section mounts.
const enterGroundB = (ground: 'kart' | 'lidar', get: Getter, set: Setter) => {
  if (ground === 'kart') {
    set(backgroundLayerHalves.b, get(kartVariantHalves.b));
    return;
  }
  // The national mosaic, not the held flight, which need not cover this screen.
  set(activeLidarStyleHalves.b, DEFAULT_LIDAR_PROJECT_STYLE);
  set(backgroundLayerHalves.b, 'lidarHillshade');
};

/** B is seeded from A only on the way out of `single`. */
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

// Narrower than A's `VALID_STARTUP_LAYERS`, and why, in
// `docs/architecture.md`.
const LINKABLE_GROUNDS_B = new Set<BackgroundLayerName>([
  ...KART_VARIANTS,
  'lidarHillshade',
  // Dropped where there is no `nib-proxy`, so a link made elsewhere cannot
  // seat a ground this installation cannot draw.
  ...(serviceOn('flyfoto') ? (['flyfoto'] as BackgroundLayerName[]) : []),
]);

const DEGRADES_TO = new Map<string, BackgroundLayerName>([
  ['lidarProject', 'lidarHillshade'],
  ['lidarCvat', 'lidarHillshade'],
  ['flyfotoProject', 'flyfoto'],
]);

/** What `backgroundLayerB` says for a ground, or null for one no link can
 *  carry. Both the reader and the writer go through it. */
const linkableGroundB = (name: string): BackgroundLayerName | null => {
  const ground = DEGRADES_TO.get(name) ?? (name as BackgroundLayerName);
  return LINKABLE_GROUNDS_B.has(ground) ? ground : null;
};

// A variant off the URL is a pick rather than a re-entry, so it lands in
// `kartVariantHalves.b` too.
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

// Read at import, like `lok` and `lidarRender`: `compareUrlAtomEffect` rewrites
// all three the moment it mounts, before the restore below runs.
const linkedViewMode = readLinkedViewMode();
const linkedGroundB = linkableGroundB(
  getUrlParameter('backgroundLayerB') ?? '',
);
const linkedSplit = readLinkedSplit();

let compareRestored = false;

/** Reopen the two-ground view a link described. Driven from a mount effect,
 *  spent on the first run, and the named ground applied after the mode — all
 *  three load-bearing, see `docs/architecture.md`. */
export const restoreCompareFromUrlAtom = atom(null, (get, set) => {
  if (compareRestored) return;
  compareRestored = true;
  if (!linkedViewMode) return;

  // Before the mode, so the first build of the B stack clips to the right seam.
  if (linkedSplit != null) {
    setCurtainSplit(linkedSplit);
    set(compareSplitAtom, linkedSplit);
  }
  set(selectViewModeAtom, linkedViewMode);
  if (linkedGroundB) enterNamedGroundB(linkedGroundB, get, set);
});

/** The view mode and B's ground on the address bar. Not a tail on
 *  `compareLayerAtomEffect`: that one returns early on three paths and spans
 *  an await. */
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
  // The seam is `CompareCurtain`'s to write, and it stands in the curtain only.
  if (mode === 'split') removeUrlParameter('curtain');
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
