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
import { activeFlyfotoProjectHalves } from '../layers/config/backgroundLayers/flyfotoBackground';
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
import {
  standardVariantHalves,
  type StandardVariant,
} from '../layers/config/backgroundLayers/standardVariants';
import { clearCompareLayers, installCompareLayers } from './curtainLayers';
import { compareFocusAtom, compareOnAtom, seedHalfB } from './halves';

/*
 * Sammenlign — the same ground twice, split by a curtain.
 *
 * Flipping between grounds with the digit keys answers "what does this look
 * like in LiDAR", but it cannot answer "is that bump in the ortofoto the same
 * bump as in the relief" — that needs both on screen at once, in register.
 * So: the ordinary background stack keeps the whole map (the A half), a
 * second stack is built by the same rules and clipped to the right of a
 * draggable edge (the B half).
 *
 * The two halves are two sets of the same atoms, and the ribbon points at one
 * of them at a time — src/map/compare/halves.ts has the argument for that
 * shape. What it buys is that the B half is not a lesser thing with a ground
 * and no settings: dataset, style, DTM/DOM, hybrid and the W/S ring all work
 * on it, so "this acquisition against that one" is expressible.
 *
 * Terreng is not offered as a B half. It is a client-side render over the
 * background rather than a background, and it is already the case that
 * putting it on the A side and any raster ground on the B side gives exactly
 * the comparison — relief left, photograph right.
 *
 * Nothing here is persisted to the URL. Two live tile stacks are roughly
 * twice the GetMap requests against a rate limit shared by every visitor of
 * the deployment (docs/wms-proxy-and-tiles.md), so compare is a thing you
 * turn on, not a thing a shared link turns on for someone else.
 */
/**
 * Every GroundMode except Terreng, spelled out rather than imported: this is
 * a map module and useGroundMode is a shell one. The tripwire against drift
 * is CompareControl, which narrows a GroundMode into this type and stops
 * compiling if a sixth ground appears.
 */
export type CompareGround = 'standard' | 'lidar' | 'hybrid' | 'flyfoto';

/** Where the curtain edge sits, as a fraction of the map width. */
export const compareSplitAtom = atom(0.5);

/**
 * Which background layer a ground mode means, given what is already picked.
 *
 * The same mapping useGroundMode's `select` makes imperatively, needed once
 * more here because entering compare has to write B's ground *before* React
 * has re-rendered with the focus switch — so it cannot go through `select`,
 * whose closure would still send the write to A.
 */
const groundLayer = (
  ground: CompareGround,
  standardVariant: StandardVariant,
  lidarProject: LidarProject | null,
  flyfotoProject: FlyfotoProject | null,
): BackgroundLayerName => {
  // Whichever cartography this half was last set to, not necessarily topo —
  // amtskart against a hillshade is one of the comparisons worth making.
  if (ground === 'standard') return standardVariant;
  if (ground === 'flyfoto') {
    return flyfotoProject ? 'flyfotoProject' : 'flyfoto';
  }
  return lidarProject ? 'lidarProject' : 'lidarHillshade';
};

/**
 * Raise the curtain on `ground`, and point the ribbon at the new half.
 *
 * B starts as a copy of A and is then moved to the requested ground, so the
 * only difference between the halves is the one thing the user asked for.
 * Focus lands on B because that is the half they have just brought into
 * existence and are about to describe; leaving puts it back on A.
 */
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
        get(standardVariantHalves.b),
        get(activeLidarProjectHalves.b),
        get(activeFlyfotoProjectHalves.b),
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

// Same reason as the background effect's own generation counter: the build
// awaits, the atoms move faster than the round trip, and an earlier run
// resolving last would install a stack the user has already changed.
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

  const generation = ++compareGeneration;

  // 'empty' is unreachable from the ribbon but reachable from ?backgroundLayer
  // on the A half, and B is seeded from A. A curtain over nothing is just the
  // A half with a line down it, so take the whole thing down instead.
  if (!on || layerName === 'empty') {
    clearCompareLayers();
    return;
  }

  const stack = resolveStack(layerName, {
    lidarProject,
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
