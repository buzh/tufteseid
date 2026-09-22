import { atom, getDefaultStore } from 'jotai';
import { atomEffect } from 'jotai-effect';
import type { FlyfotoProject } from '../layers/config/backgroundLayers/flyfotoProjects';
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
  type KartVariant,
  kartVariantHalves,
} from '../layers/config/backgroundLayers/kartVariants';
import { lidarAutoDatasetHalves } from '../layers/config/backgroundLayers/lidarAuto';
import {
  activeLidarModelHalves,
  activeLidarProjectHalves,
  activeLidarStyleHalves,
  effectiveLidarStyle,
  lidarFlightGround,
  type LidarModel,
  LidarProject,
} from '../layers/config/backgroundLayers/lidarProjects';
import {
  buildStack,
  resolveStack,
} from '../layers/config/backgroundLayers/stack';
import {
  clearCompareLayers,
  compareHost,
  installCompareLayers,
} from './compareLayers';
import { seedHalfB, type ViewMode, viewModeAtom } from './halves';

// Two grounds at once — the same view read twice. The ordinary background stack
// is the A half and keeps the left of the screen; a second stack built by the
// same rules is the B half. Which shape that takes is `viewModeAtom`
// (`halves.ts`); what it costs is why neither shape is persisted to the URL —
// two live tile stacks are roughly twice the GetMap requests against a rate
// limit this deployment shares across every visitor.

/** Every GroundMode, spelled out rather than imported: this is a map module and
 * `src/grounds/` is a surface one. */
export type CompareGround = 'kart' | 'lidar' | 'flyfoto';

/** Where the curtain edge sits, as a fraction of the map width. */
export const compareSplitAtom = atom(0.5);

// The arms' own entry rules again, because seeding B happens before React
// re-renders with the second ground section mounted.
const groundLayer = (
  ground: CompareGround,
  kartVariant: KartVariant,
  lidarProject: LidarProject | null,
  flyfotoProject: FlyfotoProject | null,
  lidarStyle: string,
  lidarModel: LidarModel,
): BackgroundLayerName => {
  // Whichever cartography this half was last set to, not necessarily topo.
  if (ground === 'kart') return kartVariant;
  if (ground === 'flyfoto') {
    return flyfotoProject ? 'flyfotoProject' : 'flyfoto';
  }
  // A flight if one is held, and then `lidarFlightGround` off the render held
  // with it — the same namer `useLidarControls` uses, so entering on a cached
  // render keeps the cache and entering on a WMS style does not hand the
  // cache's layer name to a GetMap.
  if (!lidarProject) return 'lidarHillshade';
  return lidarFlightGround(lidarStyle, lidarModel);
};

// What B opens on. The two grounds this app exists to read against each other
// are relief and cartography, so B is whichever of those A is not; ortofoto is
// a ground the reader asks for rather than one a second pane guesses at.
const contrastingGround = (a: BackgroundLayerName): CompareGround =>
  isKartVariant(a) ? 'lidar' : 'kart';

/**
 * Pick a view. B starts as a copy of A and is then moved off it, so the only
 * difference is the comparison itself — and only on the way out of `single`:
 * moving between the curtain and the split keeps B where the reader put it.
 */
export const selectViewModeAtom = atom(
  null,
  (get, set, mode: ViewMode) => {
    const previous = get(viewModeAtom);
    if (mode === previous) return;
    if (previous === 'single' && mode !== 'single') {
      seedHalfB(get, set);
      // A comparison term that follows the viewport is not a comparison term.
      set(lidarAutoDatasetHalves.b, false);
      const ground = contrastingGround(get(backgroundLayerHalves.a));
      set(
        backgroundLayerHalves.b,
        groundLayer(
          ground,
          get(kartVariantHalves.b),
          get(activeLidarProjectHalves.b),
          get(activeFlyfotoProjectHalves.b),
          get(activeLidarStyleHalves.b),
          get(activeLidarModelHalves.b),
        ),
      );
    }
    set(viewModeAtom, mode);
  },
);

// The build awaits, and an earlier run resolving last would install a stack the
// user has already changed.
let compareGeneration = 0;

export const compareLayerAtomEffect = atomEffect((get) => {
  const mode = get(viewModeAtom);
  // The B half throughout, mirroring backgroundLayerAtomEffect's A half.
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
      // Resolved before the await as well as after: the host is what the layers
      // are built into, and a mode change mid-build would build into one map
      // and install into the other.
      const host = compareHost();
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
        { host, clip: mode === 'curtain' },
      );
    } catch (error) {
      console.error('[compare] failed to build the B stack', error);
    }
  };

  install();
});
