import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { activeLocalityAtom } from '../localities/atoms';
import { ribbonToolAtom } from '../localities/toolAtoms';
import { terrainStandaloneBboxAtom } from '../terrain/atoms';
import type { useTerrainViewport } from '../terrain/useTerrainViewport';
import type { FlyfotoControls } from './flyfoto/useFlyfotoControls';
import type { LidarControls } from './lidar/useLidarControls';

/**
 * The five grounds, as one control surface.
 *
 * Standard, LiDAR, Hybrid and Flyfoto are backgrounds; Terreng is a
 * client-side render that covers them. Underneath they are three different
 * mechanisms — a background-layer atom, a modifier flag, and a rectangle to
 * analyse — and the row-1 buttons used to speak all three separately, with
 * Terreng living in a different group and disappearing whenever a lokalitet
 * was open. That is what made flipping between them a matter of remembering
 * where each control was, rather than a keystroke.
 *
 * So: one list, one index, one setter. The order is the digit order, which is
 * also the order the buttons render in — GROUND_KEYS in
 * useBackgroundCyclingKeys is positional against this array.
 *
 * Terreng does not replace the background, it hides it. Leaving it therefore
 * costs nothing and returns you to exactly the dataset and style you left, so
 * 1→5→1 is free where 1→2→1 is a screenful of tile requests. Its rectangle
 * comes from the open lokalitet when there is one and from the viewport
 * otherwise, which is why entering it writes two different atoms.
 */
export const GROUND_MODES = [
  'standard',
  'lidar',
  'hybrid',
  'flyfoto',
  'terreng',
] as const;

export type GroundMode = (typeof GROUND_MODES)[number];

export const useGroundMode = (
  lidar: LidarControls,
  flyfoto: FlyfotoControls,
  terrain: ReturnType<typeof useTerrainViewport>,
) => {
  const locality = useAtomValue(activeLocalityAtom);
  const [tool, setTool] = useAtom(ribbonToolAtom);
  const setStandaloneBbox = useSetAtom(terrainStandaloneBboxAtom);

  // Two entrances, never both live: with a lokalitet open the standalone
  // rectangle is cleared and the panel runs off the lokalitet's own bbox.
  const terrainActive = locality ? tool === 'terrain' : terrain.active;

  const mode: GroundMode = terrainActive
    ? 'terreng'
    : flyfoto.isFlyfotoMode
      ? 'flyfoto'
      : lidar.isLidarMode
        ? lidar.hybridOverlay
          ? 'hybrid'
          : 'lidar'
        : 'standard';

  const leaveTerrain = () => {
    if (locality) setTool((cur) => (cur === 'terrain' ? null : cur));
    else setStandaloneBbox(null);
  };

  // Deliberately not memoized: every branch closes over control objects that
  // are rebuilt each render anyway, and the only consumers are event handlers
  // and a registration that re-publishes on every render by design.
  const select = (next: GroundMode) => {
    if (next !== 'terreng') leaveTerrain();
    switch (next) {
      case 'standard':
        lidar.setHybridOverlay(false);
        lidar.setBackgroundLayer('topo');
        break;
      case 'lidar':
        lidar.setHybridOverlay(false);
        // Entering the mode is not a dataset pick, so it leaves the pulldown
        // alone; enterLidar only has to put something on screen.
        if (!lidar.isLidarMode) lidar.enterLidar();
        break;
      case 'hybrid':
        lidar.setHybridOverlay(true);
        if (!lidar.isLidarMode) lidar.enterLidar();
        break;
      case 'flyfoto':
        flyfoto.enterFlyfoto();
        break;
      case 'terreng':
        if (locality) setTool('terrain');
        // frame() rather than toggle(): pressing 5 twice should be a no-op,
        // not a close, because the peek below re-selects the mode you are
        // already on when it snaps back.
        else if (!terrain.active) terrain.frame();
        break;
    }
  };

  // Hold-to-compare. `previous` is the mode before the current one, kept in
  // refs rather than state: nothing renders differently for it, and a state
  // write per mode change would re-run the resolver effects in the two
  // control hooks for no reason.
  const modeRef = useRef(mode);
  const previousRef = useRef<GroundMode | null>(null);
  const peekFromRef = useRef<GroundMode | null>(null);

  useEffect(() => {
    if (mode === modeRef.current) return;
    // A peek is not a choice, so it must not become the thing to peek back
    // to — otherwise the second press of X would return you to where you
    // already are.
    if (!peekFromRef.current) previousRef.current = modeRef.current;
    modeRef.current = mode;
  }, [mode]);

  const peekStart = () => {
    if (peekFromRef.current) return;
    const previous = previousRef.current;
    if (!previous || previous === mode) return;
    peekFromRef.current = mode;
    select(previous);
  };

  const peekEnd = () => {
    const back = peekFromRef.current;
    if (!back) return;
    // Cleared first: the effect above has to see the snap-back as a real
    // mode change, so the peeked-at mode becomes the next peek target.
    peekFromRef.current = null;
    select(back);
  };

  // A getter rather than the value: it lives in a ref precisely so that
  // changing it renders nothing, and handing the value out would put it in a
  // render's closure and make it stale by the time a handler read it.
  const previous = () => previousRef.current;

  return { mode, select, peekStart, peekEnd, previous };
};
