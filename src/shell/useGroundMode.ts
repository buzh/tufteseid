import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { activeLocalityAtom } from '../localities/atoms';
import { cycleBilderAtom } from '../localities/bilderRing';
import { ribbonToolAtom } from '../localities/toolAtoms';
import { focusedHalfAtom } from '../map/compare/halves';
import { spendProvisionalViewAtom } from '../map/groundOverlay';
import type { CycleKey } from '../map/useBackgroundCyclingKeys';
import type { FlyfotoControls } from './flyfoto/useFlyfotoControls';
import type { LidarControls } from './lidar/useLidarControls';
import type { StandardControls } from './standard/useStandardControls';
import type { TerrainAnalysis } from './terrain/useTerrainAnalysis';
import { cycleVisningAtom } from './visningRing';

/**
 * The five grounds, in digit order — `GROUND_KEYS` in
 * `useBackgroundCyclingKeys` is positional against this array. Terreng covers
 * the background rather than replacing it, so `mode` is the only honest answer
 * to which ground is being read; a control hook's own predicate is not.
 */
export const GROUND_MODES = [
  'standard',
  'lidar',
  'hybrid',
  'flyfoto',
  'terreng',
] as const;

export type GroundMode = (typeof GROUND_MODES)[number];

/**
 * Which family of modifier controls belongs to a ground. Keyed on the ground
 * on screen, never on which background layer is set: `isLidarBackground` stays
 * true under a terrain render.
 */
const groundModifiers = (
  mode: GroundMode,
): 'standard' | 'lidar' | 'flyfoto' | 'terrain' => {
  switch (mode) {
    case 'standard':
      return 'standard';
    // Hybrid is a modifier on the LiDAR stack, so it keeps LiDAR's modifiers.
    case 'lidar':
    case 'hybrid':
      return 'lidar';
    case 'flyfoto':
      return 'flyfoto';
    case 'terreng':
      return 'terrain';
  }
};

/** Mount exactly once: a second mount means a second DEM. */
export const useGroundMode = (
  standard: StandardControls,
  lidar: LidarControls,
  flyfoto: FlyfotoControls,
  terrain: TerrainAnalysis,
  /** What pressing Terreng with nothing open does: propose a rectangle, or
   * raise the sign-in dialog. */
  placeForTerrain: () => void,
) => {
  const locality = useAtomValue(activeLocalityAtom);
  const [tool, setTool] = useAtom(ribbonToolAtom);
  // Which half everything below sets and reports. Always 'a' with no curtain.
  const half = useAtomValue(focusedHalfAtom);
  const cycleVisning = useSetAtom(cycleVisningAtom);
  const cycleBilder = useSetAtom(cycleBilderAtom);
  const spendProvisional = useSetAtom(spendProvisionalViewAtom);

  // A terrain render covers the whole map, so it cannot be one side of the
  // split: on B, `mode` names B's raster ground even with one up on A.
  const terrainActive = half === 'a' && locality != null && tool === 'terrain';

  // Terreng first: it is the only ground that leaves another's background
  // switched on beneath it.
  const mode: GroundMode = terrainActive
    ? 'terreng'
    : flyfoto.isFlyfotoBackground
      ? 'flyfoto'
      : lidar.isLidarBackground
        ? lidar.hybridOverlay
          ? 'hybrid'
          : 'lidar'
        : 'standard';

  const modifiers = groundModifiers(mode);

  const leaveTerrain = () => {
    setTool((cur) => (cur === 'terrain' ? null : cur));
  };

  const enter = (next: GroundMode) => {
    // On B the ring is four buttons, and must not disturb A's terrain render.
    if (half === 'b') {
      if (next === 'terreng') return;
    } else if (next !== 'terreng') {
      leaveTerrain();
    }
    switch (next) {
      case 'standard':
        lidar.setHybridOverlay(false);
        // Whichever cartography this half was last set to: entering a ground
        // is never a dataset pick.
        standard.enterStandard();
        break;
      case 'lidar':
        lidar.setHybridOverlay(false);
        // Already loaded if a terrain render is over it.
        if (!lidar.isLidarBackground) lidar.enterLidar();
        break;
      case 'hybrid':
        lidar.setHybridOverlay(true);
        if (!lidar.isLidarBackground) lidar.enterLidar();
        break;
      case 'flyfoto':
        flyfoto.enterFlyfoto();
        break;
      case 'terreng':
        // Set, not toggled: the peek re-selects the mode you are on when it
        // snaps back, so pressing 5 twice must be a no-op.
        if (locality) setTool('terrain');
        else placeForTerrain();
        break;
    }
  };

  /**
   * `enter`, plus withdrawing the arrival cover so the ground asked for is the
   * one seen. Hold-to-compare calls `enter` instead: a peek restores itself,
   * so withdrawing there would make X quietly destructive.
   */
  const select = (next: GroundMode) => {
    spendProvisional('withdraw');
    enter(next);
  };

  // Controls leaving the bar have to be told: an unmounted pulldown never
  // fires its open-change callback, and LiDAR's open flag paints footprints on
  // the map. Standard's pulldown hangs off `Kart`, so it never leaves.
  const { standDown: lidarStandDown } = lidar;
  const { standDown: flyfotoStandDown } = flyfoto;
  const { standDown: terrainStandDown } = terrain;
  useEffect(() => {
    if (modifiers !== 'lidar') lidarStandDown();
    if (modifiers !== 'flyfoto') flyfotoStandDown();
    if (modifiers !== 'terrain') terrainStandDown();
  }, [modifiers, lidarStandDown, flyfotoStandDown, terrainStandDown]);

  // Every ring is routed from here rather than chained past the key listener:
  // both listeners are capture-phase on `document`, so registration order
  // cannot decide who answers.
  const cycle = (key: CycleKey): boolean => {
    // Inside a lokalitet W/S is the Views' and A/D the bilder rail's — a
    // reassignment, not a fallback, hence before the modifier switch. Both
    // decline through the same predicate the pulldown headings read.
    if (key === 'w' || key === 's') {
      if (cycleVisning(key === 's' ? 1 : -1)) return true;
    }
    if (key === 'a' || key === 'd') {
      if (cycleBilder(key === 'd' ? 1 : -1)) return true;
    }
    switch (modifiers) {
      case 'standard':
        return standard.cycle(key);
      case 'lidar':
        return lidar.cycle(key);
      case 'flyfoto':
        return flyfoto.cycle(key);
      case 'terrain':
        return terrain.cycle(key);
    }
  };

  // Hold-to-compare. In refs: a state write per mode change would re-run the
  // control hooks' resolver effects for no reason.
  const modeRef = useRef(mode);
  const previousRef = useRef<GroundMode | null>(null);
  const peekFromRef = useRef<GroundMode | null>(null);

  useEffect(() => {
    if (mode === modeRef.current) return;
    // A peek is not a choice, so it must not become the thing to peek back to.
    if (!peekFromRef.current) previousRef.current = modeRef.current;
    modeRef.current = mode;
  }, [mode]);

  const peekStart = () => {
    if (peekFromRef.current) return;
    const previous = previousRef.current;
    if (!previous || previous === mode) return;
    // `enter('terreng')` with nothing open starts placing a lokalitet, and key
    // release would snap out of the mode and leave the placement behind.
    if (previous === 'terreng' && !locality) return;
    peekFromRef.current = mode;
    enter(previous);
  };

  const peekEnd = () => {
    const back = peekFromRef.current;
    if (!back) return;
    // Cleared first, so the effect above sees a real mode change.
    peekFromRef.current = null;
    enter(back);
  };

  // A getter: the ref changes without rendering.
  const previous = () => previousRef.current;

  return { mode, modifiers, half, select, cycle, peekStart, peekEnd, previous };
};

export type GroundControls = ReturnType<typeof useGroundMode>;
