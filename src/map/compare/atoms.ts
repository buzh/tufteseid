import { atom, getDefaultStore } from 'jotai';
import { atomEffect } from 'jotai-effect';
import type { FlyfotoProject } from '../../localities/flyfotoProjects';
import { mapAtom } from '../atoms';
import { BackgroundLayerName } from '../layers/backgroundLayers';
import { activeFlyfotoProjectAtom } from '../layers/config/backgroundLayers/flyfotoBackground';
import {
  activeLidarModelAtom,
  activeLidarProjectAtom,
  activeLidarStyleAtom,
  effectiveLidarStyle,
  LidarProject,
} from '../layers/config/backgroundLayers/lidarProjects';
import {
  buildStack,
  resolveStack,
} from '../layers/config/backgroundLayers/stack';
import { clearCompareLayers, installCompareLayers } from './curtainLayers';

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
 * Terreng is not offered as a B half. It is a client-side render over the
 * background rather than a background, and it is already the case that
 * putting it on the A side and any raster ground on the B side gives exactly
 * the comparison — relief left, photograph right.
 */
export const COMPARE_GROUNDS = [
  'standard',
  'lidar',
  'hybrid',
  'flyfoto',
] as const;

export type CompareGround = (typeof COMPARE_GROUNDS)[number];

/** The B half's ground, or `null` for "compare is off". */
export const compareGroundAtom = atom<CompareGround | null>(null);

/** Where the curtain edge sits, as a fraction of the map width. */
export const compareSplitAtom = atom(0.5);

/*
 * The B half has no dataset picker of its own: the pulldowns in ribbon row 1
 * are the one place a dataset is chosen, and B follows whatever they last
 * named. Where B is in the same family as A that means the two halves show
 * the same dataset (LiDAR against hybrid compares just the overlay, which is
 * the point of asking for it); where it isn't, it means the acquisition you
 * picked while you were in that mode is what comes back.
 */
const compareBackground = (
  ground: CompareGround,
  lidarProject: LidarProject | null,
  flyfotoProject: FlyfotoProject | null,
): BackgroundLayerName => {
  if (ground === 'standard') return 'topo';
  if (ground === 'flyfoto') {
    return flyfotoProject ? 'flyfotoProject' : 'flyfoto';
  }
  return lidarProject ? 'lidarProject' : 'lidarHillshade';
};

// Same reason as the background effect's own generation counter: the build
// awaits, the atoms move faster than the round trip, and an earlier run
// resolving last would install a stack the user has already changed.
let compareGeneration = 0;

export const compareLayerAtomEffect = atomEffect((get) => {
  const ground = get(compareGroundAtom);
  const lidarProject = get(activeLidarProjectAtom);
  const lidarStyle = get(activeLidarStyleAtom);
  const lidarModel = get(activeLidarModelAtom);
  const flyfotoProject = get(activeFlyfotoProjectAtom);

  const generation = ++compareGeneration;

  if (!ground) {
    clearCompareLayers();
    return;
  }

  const layerName = compareBackground(ground, lidarProject, flyfotoProject);
  const stack = resolveStack(layerName, {
    lidarProject,
    lidarStyle: effectiveLidarStyle(lidarStyle, lidarModel),
    lidarModel,
    flyfotoProject,
    hybridOverlay: ground === 'hybrid',
  });
  if (!stack) return;

  const install = async () => {
    try {
      const map = getDefaultStore().get(mapAtom);
      const projection = map.getView().getProjection().getCode();
      const built = await buildStack(stack, projection, 'cmp');
      if (generation !== compareGeneration) return;
      if (!built) return;

      const all = [...built.under, ...built.over];
      for (const { layer, opacity } of all) layer.setOpacity(opacity);
      installCompareLayers(all.map((e) => e.layer));
    } catch (error) {
      console.error('[compare] failed to build the B stack', error);
    }
  };

  install();
});
