import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { activeLocalityAtom } from '../localities/atoms';
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
 * 1→5→1 is free where 1→2→1 is a screenful of tile requests. Its rectangle is
 * the open lokalitet's, and there is no second answer any more: Terreng used
 * to have a standalone entrance with a rectangle of its own, and selecting it
 * with nothing open now **places** the lokalitet instead (`placeForTerrain`,
 * docs/lokalitet-view.md §8). One rectangle, one owner of it.
 *
 * That cheapness has a price this hook pays for everyone: `mode` is the *only*
 * honest answer to "what ground is the user reading". The background layer is
 * still LiDAR or ortofoto underneath a terrain render, so anything that speaks
 * about the visible ground — which modifier pulldowns the ribbon shows
 * (`modifiers`), which ring the keyboard walks (`cycle`) — has to come from
 * here rather than from the control hooks' own predicates.
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
 * Which family of modifier controls belongs to a ground: what the settings
 * strip puts under row 1, and — for the three raster families — the ring W/S
 * walks.
 *
 * Total, with no `null` case, even though Standard's arm no longer draws a
 * strip. The value still has work to do there — it is what `cycle` routes W/S
 * by, and what RibbonSettingsRow tests to decide it has nothing to render —
 * so collapsing it to `null` would trade one honest name for two special
 * cases.
 *
 * Terreng is in the list like the rest of them. Its knobs used to live in a
 * dock column down the side of the map, so pressing 5 moved the controls to a
 * different part of the screen and then covered the terrain they described;
 * the strip is where every other ground's modifiers already were.
 *
 * Keyed on the ground *on screen*, deliberately not on which background layer
 * is set. Those two answers differ for exactly one mode, and it is the one
 * this function exists for: Terreng covers the background rather than
 * replacing it, so `isLidarBackground` / `isFlyfotoBackground` stay true
 * underneath a terrain render — and a bar driven off them offers ortofoto
 * acquisitions for imagery nobody can see, while the user reads relief.
 */
const groundModifiers = (
  mode: GroundMode,
): 'standard' | 'lidar' | 'flyfoto' | 'terrain' => {
  switch (mode) {
    case 'standard':
      return 'standard';
    // Hybrid is a modifier on the LiDAR stack, so it keeps LiDAR's own
    // modifiers — dataset, style, DTM/DOM — working underneath it (§5.2).
    case 'lidar':
    case 'hybrid':
      return 'lidar';
    case 'flyfoto':
      return 'flyfoto';
    case 'terreng':
      return 'terrain';
  }
};

export const useGroundMode = (
  standard: StandardControls,
  lidar: LidarControls,
  flyfoto: FlyfotoControls,
  terrain: TerrainAnalysis,
  /**
   * What pressing Terreng with nothing open does: propose a rectangle seeded
   * from the visible map, to be placed and then created with Terreng armed in
   * it — or raise the sign-in dialog. The argument slot the standalone
   * rectangle used to occupy.
   */
  placeForTerrain: () => void,
) => {
  const locality = useAtomValue(activeLocalityAtom);
  const [tool, setTool] = useAtom(ribbonToolAtom);
  // Which half of the compare curtain the ribbon is pointed at, and therefore
  // which half everything below sets and reports. Always 'a' with the curtain
  // down, so nothing here changes for the ordinary single-ground case.
  const half = useAtomValue(focusedHalfAtom);
  // The lokalitet's own ring, which takes W/S ahead of the ground's — see
  // `cycle` below.
  const cycleVisning = useSetAtom(cycleVisningAtom);
  // The arrival cover's latch — see `select` below.
  const spendProvisional = useSetAtom(spendProvisionalViewAtom);

  // One entrance. Terreng is a reading *of a rectangle*, and the only
  // rectangle in the app is a lokalitet's.
  //
  // Never on the B half. Terreng is a client-side render over the whole map
  // rather than a background, so it cannot be one side of a split — and while
  // focus is on B, `mode` has to name B's raster ground even though a terrain
  // render may well be up on the A side. That combination is supported, and
  // it is one of the better ones: relief left, photograph right.
  const terrainActive = half === 'a' && locality != null && tool === 'terrain';

  // Terreng first, because it is the only ground that leaves another one's
  // background switched on beneath it. Reading the background atom below this
  // line answers "what is loaded", not "what is the user looking at".
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

  // Deliberately not memoized: every branch closes over control objects that
  // are rebuilt each render anyway, and the only consumers are event handlers
  // and a registration that re-publishes on every render by design.
  const enter = (next: GroundMode) => {
    // On the B half the ring is four buttons, not five, and it must not
    // disturb the A half's terrain render either way: that render is very
    // often the left-hand term of the comparison being set up.
    if (half === 'b') {
      if (next === 'terreng') return;
    } else if (next !== 'terreng') {
      leaveTerrain();
    }
    switch (next) {
      case 'standard':
        lidar.setHybridOverlay(false);
        // Whichever of the five this half was last set to, not topo: entering
        // a mode is never a dataset pick, here no more than in LiDAR.
        standard.enterStandard();
        break;
      case 'lidar':
        lidar.setHybridOverlay(false);
        // Entering the mode is not a dataset pick, so it leaves the pulldown
        // alone; enterLidar only has to put something on screen. Nothing to
        // put there if the stack is already loaded under a terrain render.
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
        // Setting rather than toggling: pressing 5 twice should be a no-op,
        // not a close, because the peek below re-selects the mode you are
        // already on when it snaps back.
        if (locality) setTool('terrain');
        // Nothing open. Reading relief is the one thing here no WMS can do,
        // so the answer is not a refusal — it is the rectangle, proposed. The
        // cost is stated where it belongs (docs/lokalitet-view.md §8):
        // computing relief now requires an account, because it now requires
        // somewhere to put it.
        else placeForTerrain();
        break;
    }
  };

  /**
   * Asking for a ground, which is `enter` plus the one thing a peek must not
   * do (§10.1).
   *
   * A lokalitet opens with its cover on the ground, laid there by the app
   * rather than chosen — and it is an opaque image over the whole rectangle,
   * i.e. over everything any of the five grounds has to say. So the first
   * *ask* takes the guess back down: press Terreng and you see relief, press
   * Flyfoto and you see the photograph. The withdrawal is one member, once,
   * and only ever the one nobody asked for — `provisionalViewAtom` for why
   * that is not the arbiter §13 deleted, and for the switches that spend the
   * latch without withdrawing anything.
   *
   * Hold-to-compare goes to `enter` instead. A peek returns you to exactly
   * where you were on key release, so it is not an ask about the stack, and
   * withdrawing on the way out with nothing to restore on the way back would
   * make X quietly destructive.
   */
  const select = (next: GroundMode) => {
    spendProvisional('withdraw');
    enter(next);
  };

  // The other half of `modifiers`: controls that leave the bar have to be
  // told, because a pulldown that is unmounted never fires its own
  // open-change callback — and LiDAR's open flag is what paints footprint
  // polygons on the map. Only the *controls* stand down; the background stays
  // exactly as it was, which is what makes coming back out of Terreng free.
  //
  // Three of the four, not all four: Standard's pulldown hangs off the `Kart`
  // button rather than off the strip, so it never leaves the bar and there is
  // nothing to stand down — see useStandardControls.
  const { standDown: lidarStandDown } = lidar;
  const { standDown: flyfotoStandDown } = flyfoto;
  const { standDown: terrainStandDown } = terrain;
  useEffect(() => {
    if (modifiers !== 'lidar') lidarStandDown();
    if (modifiers !== 'flyfoto') flyfotoStandDown();
    if (modifiers !== 'terrain') terrainStandDown();
  }, [modifiers, lidarStandDown, flyfotoStandDown, terrainStandDown]);

  // A/D/W/S/E go to the ring of the ground on screen — after the lokalitet's
  // own, which takes W/S where there is one to take (see below). The
  // four control hooks each know *how* to walk their own ring but cannot see
  // which ground is up from where they sit, so whether they are asked at all
  // is decided here — otherwise W/S in Terreng would walk an invisible
  // background, spending a screenful of tile requests per keypress on imagery
  // under a terrain render.
  //
  // Terreng is a case here rather than the `default` as of the openness work.
  // It had no ring while its five visualizations were a segmented control on
  // the strip — "a client-side render has no dataset" — but eight of them are
  // a pulldown, and a pulldown in this app comes with W/S. What it walks is
  // not a dataset in the sense the other three mean: same elevation grid,
  // eight ways of drawing it.
  const cycle = (key: CycleKey): boolean => {
    /*
     * Inside a lokalitet, W/S belongs to the lokalitet's own kept renders
     * (`visningRing.ts`). An extract, a VAT and a 1937 ortofoto of one
     * rectangle are what somebody opened the place to compare, and the group
     * holding them was the one pulldown in the app without a ring.
     *
     * Before the modifier switch, not after: this is a reassignment of the
     * keys rather than a fallback, so with a lokalitet open and one View in it
     * the ground's dataset ring is the pulldown's and the strip's. The two
     * cases where it declines and the ground answers as before — an empty ring
     * and the curtain's B half — are `visningRingHasKeysAtom`, which is also
     * what the four dataset headings read, so no heading can promise a ring
     * the keys have left.
     */
    if (key === 'w' || key === 's') {
      if (cycleVisning(key === 's' ? 1 : -1)) return true;
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
    // A peek is not an act of authorship, and `enter('terreng')` with nothing
    // open starts *placing* a lokalitet. Closing one leaves 'terreng' as the
    // mode before this one, so delegating blindly would have a held X put a
    // rectangle and a row on the screen and then snap straight back out of the
    // mode on key release, leaving the placement behind it — or raise the
    // sign-in dialog, signed out.
    if (previous === 'terreng' && !locality) return;
    peekFromRef.current = mode;
    enter(previous);
  };

  const peekEnd = () => {
    const back = peekFromRef.current;
    if (!back) return;
    // Cleared first: the effect above has to see the snap-back as a real
    // mode change, so the peeked-at mode becomes the next peek target.
    peekFromRef.current = null;
    enter(back);
  };

  // A getter rather than the value: it lives in a ref precisely so that
  // changing it renders nothing, and handing the value out would put it in a
  // render's closure and make it stale by the time a handler read it.
  const previous = () => previousRef.current;

  return { mode, modifiers, half, select, cycle, peekStart, peekEnd, previous };
};

export type GroundControls = ReturnType<typeof useGroundMode>;
