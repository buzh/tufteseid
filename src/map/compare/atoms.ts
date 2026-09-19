import { atom, getDefaultStore } from 'jotai';
import { atomEffect } from 'jotai-effect';
import type { FlyfotoProject } from '../../localities/flyfotoProjects';
import { mapAtom } from '../atoms';
import { BackgroundLayerName } from '../layers/backgroundLayers';
import {
  backgroundLayerHalves,
  hybridContoursHalves,
  hybridOverlayHalves,
} from '../layers/config/backgroundLayers/atoms';
import {
  activeCvatAcquisitionHalves,
  type CvatAcquisition,
} from '../layers/config/backgroundLayers/cvatGround';
import { activeFlyfotoProjectHalves } from '../layers/config/backgroundLayers/flyfotoBackground';
import {
  type KartVariant,
  kartVariantHalves,
} from '../layers/config/backgroundLayers/kartVariants';
import { lidarAutoDatasetHalves } from '../layers/config/backgroundLayers/lidarAuto';
import {
  activeLidarModelHalves,
  activeLidarProjectHalves,
  activeLidarStyleHalves,
  effectiveLidarStyle,
  LidarProject,
} from '../layers/config/backgroundLayers/lidarProjects';
import {
  buildStack,
  resolveStack,
} from '../layers/config/backgroundLayers/stack';
import { clearCompareLayers, installCompareLayers } from './curtainLayers';
import { compareFocusAtom, compareOnAtom, seedHalfB } from './halves';

// Sammenlign — the same ground twice: the ordinary background stack keeps the
// whole map (A), a second stack built by the same rules is clipped to the right
// of a draggable edge (B). Nothing here is persisted to the URL, because two
// live tile stacks are roughly twice the GetMap requests against a shared rate
// limit.

/** Every GroundMode except `terreng` (Analyse), spelled out rather than
 * imported: this is a map module and useGroundMode is a shell one. */
export type CompareGround = 'kart' | 'lidar' | 'hybrid' | 'flyfoto';

/** Where the curtain edge sits, as a fraction of the map width. */
export const compareSplitAtom = atom(0.5);

// `useGroundMode.select`'s mapping again, because entering compare writes B's
// ground before React re-renders with the focus switch.
const groundLayer = (
  ground: CompareGround,
  seeded: BackgroundLayerName,
  kartVariant: KartVariant,
  lidarProject: LidarProject | null,
  flyfotoProject: FlyfotoProject | null,
  cvatAcquisition: CvatAcquisition | null,
): BackgroundLayerName => {
  // Whichever cartography this half was last set to, not necessarily topo.
  if (ground === 'kart') return kartVariant;
  if (ground === 'flyfoto') {
    return flyfotoProject ? 'flyfotoProject' : 'flyfoto';
  }
  // `seeded` is A's layer, already copied over: entering the curtain on the
  // cached ground keeps it, rather than dropping to the WMS dataset A was not
  // showing. Its acquisition was copied with it, and without one there would be
  // nothing to draw. The two WMS datasets are still chosen by whether one is
  // held.
  if (seeded === 'lidarCvat' && cvatAcquisition) return 'lidarCvat';
  return lidarProject ? 'lidarProject' : 'lidarHillshade';
};

// B starts as a copy of A and is then moved, so the only difference is the one
// thing asked for.
export const enterCompareAtom = atom(
  null,
  (get, set, ground: CompareGround) => {
    seedHalfB(get, set);
    // A comparison term that follows the viewport is not a comparison term.
    set(lidarAutoDatasetHalves.b, false);
    set(hybridOverlayHalves.b, ground === 'hybrid');
    set(
      backgroundLayerHalves.b,
      groundLayer(
        ground,
        get(backgroundLayerHalves.b),
        get(kartVariantHalves.b),
        get(activeLidarProjectHalves.b),
        get(activeFlyfotoProjectHalves.b),
        get(activeCvatAcquisitionHalves.b),
      ),
    );
    set(compareOnAtom, true);
    set(compareFocusAtom, 'b');
  },
);

export const leaveCompareAtom = atom(null, (_get, set) => {
  set(compareOnAtom, false);
  set(compareFocusAtom, 'a');
});

// The build awaits, and an earlier run resolving last would install a stack the
// user has already changed.
let compareGeneration = 0;

export const compareLayerAtomEffect = atomEffect((get) => {
  const on = get(compareOnAtom);
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

  // 'empty' is unreachable from the ribbon but reachable from ?backgroundLayer.
  if (!on || layerName === 'empty') {
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
      const map = getDefaultStore().get(mapAtom);
      const projection = map.getView().getProjection().getCode();
      const built = await buildStack(stack, projection, 'cmp');
      if (generation !== compareGeneration) return;
      if (!built) return;

      for (const { layer, opacity } of [...built.under, ...built.over]) {
        layer.setOpacity(opacity);
      }
      installCompareLayers(
        built.under.map((e) => e.layer),
        built.over.map((e) => e.layer),
      );
    } catch (error) {
      console.error('[compare] failed to build the B stack', error);
    }
  };

  install();
});
