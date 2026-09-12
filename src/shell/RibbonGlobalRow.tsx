import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { isSignedInAtom } from '../auth/atoms';
import { isAuthDialogOpenAtom } from '../auth/atoms-dialog';
import { type BeholdOffer, beholdOfferAtom } from '../localities/behold';
import { useCreateLocalityFromViewport } from '../localities/createFromBbox';
import { ribbonToolAtom } from '../localities/toolAtoms';
import { infoToolAtom } from '../map/featureInfo/infoTool';
import { type MapTool, mapToolAtom } from '../map/overlay/atoms';
import {
  useRegisterBackgroundCycle,
  useRegisterGroundKeys,
} from '../map/useBackgroundCyclingKeys';
import { IconButton, Tooltip } from '../ui';
import { useFlyfotoControls } from './flyfoto/useFlyfotoControls';
import { groundHandleAtom } from './groundHandle';
import { HeritageControl } from './heritage/HeritageControl';
import { useLidarControls } from './lidar/useLidarControls';
import { ModeButton } from './ModeButton';
import { RibbonAccount } from './RibbonAccount';
import { RibbonMeasure } from './RibbonMeasure';
import { RibbonSearch } from './RibbonSearch';
import { RibbonSettingsRow } from './RibbonSettingsRow';
import styles from './Ribbon.module.css';
import { useStandardControls } from './standard/useStandardControls';
import { useTerrainAnalysis } from './terrain/useTerrainAnalysis';
import { GROUND_MODES, useGroundMode } from './useGroundMode';
import { useRecreateView } from './useRecreateView';

/**
 * Row 1 — always present, independent of any lokalitet: what the map shows
 * and how to find a place on it.
 *
 * Left to right, and the order is the argument: find a place, choose what the
 * ground looks like, overlay the heritage record on top of it, then the tools
 * that act on what you are looking at.
 *
 * The row renders with its settings strip below it (RibbonSettingsRow), which
 * is where the *modifiers* on the chosen ground now live. Row 1 answers "what
 * am I looking at", the strip answers "how"; keeping the second question off
 * this row is what stops it wrapping to two lines on a laptop as soon as
 * LiDAR is on. Terreng adds a third row under the strip for its sliders, and
 * is the only ground that does. All of them come from this component because
 * all of them run off the four control hooks below, which are mounted once
 * and only here.
 *
 * The ground buttons are one ring, in digit order, driven by useGroundMode.
 * Four of the five are drawn here; the fifth, Terreng, renders on the
 * lokalitet row (docs/lokalitet-view.md §8) because it reads a rectangle and
 * the only rectangle in the app is a lokalitet's. Digit 5 still selects it —
 * `GROUND_KEYS` is positional against GROUND_MODES, not against what this row
 * draws — and with nothing open it creates the lokalitet first.
 *
 * Hybrid is the odd one out and stays a mode here on purpose: it is a modifier
 * on the LiDAR stack (which is why picking it activates the national mosaic
 * when nothing LiDAR is on yet), but it is also one of the five things you
 * flip between, and splitting the ring to say so would cost more than it
 * explains. DTM/DOM and the style pick remain modifiers and stay on the
 * settings strip. docs/ui-architecture.md §5.2.
 *
 * Standard, LiDAR and Flyfoto each bring a dataset pulldown and a keyboard
 * ring, and only one of the three is ever on screen — this component is where
 * they are chained, because there is exactly one registered cycle handler. The
 * pulldowns themselves render on the strip.
 *
 * Sammenlign has left this row too, for the same reason and to the same
 * place. It still needs the ring's current and previous mode to pick a
 * sensible other half, which is what `groundHandleAtom` below carries. Once it
 * is on, this whole row — buttons, digits, W/S — describes whichever half of
 * the curtain the strip's A|B switch names. Nothing here has to know that; the
 * ground atoms route themselves (src/map/compare/halves.ts).
 */
export const RibbonGlobalRow = () => {
  const { t } = useTranslation();
  const isSignedIn = useAtomValue(isSignedInAtom);
  const [tool, setTool] = useAtom(mapToolAtom);
  const [infoTool, setInfoTool] = useAtom(infoToolAtom);
  const standard = useStandardControls();
  const lidar = useLidarControls();
  const flyfoto = useFlyfotoControls();
  const openAuthDialog = useSetAtom(isAuthDialogOpenAtom);
  const setRibbonTool = useSetAtom(ribbonToolAtom);
  // "Ny lokalitet" frames the visible map rather than arming a box drag —
  // and so, now, does pressing Terreng with nothing open.
  const { create: createFromViewport, creating } =
    useCreateLocalityFromViewport();

  /*
   * Terreng with no lokalitet open (docs/lokalitet-view.md §8).
   *
   * There used to be a second entrance here — a free-floating rectangle in
   * `terrainStandaloneBboxAtom`, framed on the press and turned into a
   * lokalitet later by a `Lagre` of its own. It is gone, and this is what
   * replaced it: the rectangle is made first, and everything downstream has
   * exactly one answer to "what am I analysing".
   *
   * The bill, stated rather than hidden: relief now needs an account. That
   * was the price of the second entrance not existing, and the second
   * entrance was two rectangles, two saves and a `Lagre` that could create a
   * lokalitet nobody had asked for.
   */
  const enterTerrainHere = async () => {
    if (!isSignedIn) {
      openAuthDialog(true);
      return;
    }
    const rec = await createFromViewport();
    // Only on success: a failed create must not leave the tool armed for
    // whichever lokalitet is opened next.
    if (rec) setRibbonTool('terrain');
  };

  // The DEM, the render and every knob that shapes it. Mounted here with the
  // other three control hooks, and for the same reason: its controls are
  // spread over the two rows below, and the analysis behind them must not exist
  // twice. Unconditional — the hook itself decides whether a rectangle is
  // being analysed, and hiding it behind `ground.modifiers` would throw the
  // DEM away every time someone glanced at another ground.
  //
  // Above useGroundMode, because that is where its visualization ring is
  // chained with the other three. It reads the atoms it needs directly and
  // takes nothing from `ground`, so the order is free.
  const terrain = useTerrainAnalysis();
  const ground = useGroundMode(standard, lidar, flyfoto, terrain, () => {
    void enterTerrainHere();
  });
  // Gjenskap. Mounted here because this is where the four control hooks are,
  // and a saved view is applied by writing all four — see useRecreateView.
  useRecreateView(ground, lidar, flyfoto, terrain);

  // A/D/W/S/E. useGroundMode routes them to the ring of the ground on screen;
  // there is exactly one registered handler, so the two halves compose there
  // rather than each registering. The document listener lives at the shell
  // root (useMapSideEffects).
  useRegisterBackgroundCycle(ground.cycle);
  // 1–5 and hold-X, positional against GROUND_MODES — which is the order the
  // buttons render in, except that Terreng's is on the lokalitet row.
  useRegisterGroundKeys({
    select: (position) => ground.select(GROUND_MODES[position - 1]),
    peekStart: ground.peekStart,
    peekEnd: ground.peekEnd,
  });

  /*
   * Terreng and Sammenlign render on the lokalitet row now (§8), which is
   * this row's sibling — so what they need crosses the gap on an atom, the
   * way `beholdOfferAtom` already does in the same direction.
   *
   * Through a ref so the atom is written only when `mode` or `half` actually
   * changes: `select` and `previous` are fresh closures every render, and
   * publishing those directly would re-render the lokalitet row on every
   * keystroke in the search field above it.
   */
  const setGroundHandle = useSetAtom(groundHandleAtom);
  const groundRef = useRef(ground);
  groundRef.current = ground;
  const { mode: groundMode, half: groundHalf } = ground;
  useEffect(() => {
    setGroundHandle({
      mode: groundMode,
      half: groundHalf,
      previous: () => groundRef.current.previous(),
      select: (next) => groundRef.current.select(next),
    });
    // Cleared on unmount, which is how the `null` case gets to mean what
    // `groundHandle.ts` says it means: if this row crashes into its own error
    // boundary the two buttons on the sibling row go away, rather than staying
    // clickable against controls that are no longer mounted.
    return () => setGroundHandle(null);
  }, [groundMode, groundHalf, setGroundHandle]);

  /*
   * What the ground on screen offers `Behold` (docs/lokalitet-view.md §4.3).
   *
   * Published rather than passed, because the button that reads it is on the
   * lokalitet row and that row is this one's *sibling*, not its child — the
   * same gap `coverTerrainSpecAtom` crosses in the other direction. The four
   * control hooks are mounted here and only here, so this is the one place
   * that can answer the question at all.
   *
   * A dataset name, everywhere except terrain: the workspace can turn a named
   * LiDAR dataset or a named acquisition into a spec itself, and it is the
   * side that holds the write and the gallery's optimistic update. Terrain's
   * parameters are state this row owns — eight visualizations and three
   * sliders, none of it readable off the map — so that arm carries a
   * callback that says what is currently on screen.
   */
  const setBeholdOffer = useSetAtom(beholdOfferAtom);
  // Destructured, because `lidar`, `flyfoto` and `terrain` are fresh objects
  // on every render and the effect below is keyed on what actually changed.
  const { activeLidarSource, shownStyle } = lidar;
  const { describe: terrainDescribe, beholdKey: terrainKey } = terrain;
  const flyfotoProject = flyfoto.activeProject;
  useEffect(() => {
    let offer: BeholdOffer;
    switch (groundMode) {
      case 'lidar':
        offer = {
          ground: 'lidar',
          source: activeLidarSource,
          style: shownStyle,
        };
        break;
      case 'flyfoto':
        offer = { ground: 'flyfoto', project: flyfotoProject };
        break;
      case 'terreng':
        offer = {
          ground: 'terreng',
          key: terrainKey,
          describe: terrainDescribe,
        };
        break;
      default:
        // Standard and Hybrid. Hybrid *is* the LiDAR stack underneath, but its
        // roads-and-names overlay is a separate layer the extract path cannot
        // see — so keeping it would hand back a bare hillshade under the name
        // of the view being read. Skjermbilde is the honest verb there.
        //
        // The two are carried separately rather than collapsed to one refusal
        // because they are refused for different reasons, and the row is free
        // to say which.
        offer = { ground: groundMode };
    }
    setBeholdOffer(offer);
  }, [
    groundMode,
    activeLidarSource,
    shownStyle,
    flyfotoProject,
    terrainKey,
    terrainDescribe,
    setBeholdOffer,
  ]);
  // Row 1 outlives every lokalitet, so nothing here clears the offer on
  // unmount — the workspace is the shorter-lived side and stops reading it.

  const toggleTool = (name: Exclude<MapTool, null>) =>
    setTool(tool === name ? null : name);

  return (
    <>
      <div className={styles.row}>
        <RibbonSearch />

        {/* The ring. Order is GROUND_MODES, which is also 1–5. */}
        <div className={styles.group}>
          <ModeButton
            icon="map"
            label={t('ribbon.mode.standard')}
            tooltip={`${t('ribbon.mode.standardTip')} (1)`}
            active={ground.mode === 'standard'}
            onClick={() => ground.select('standard')}
          />

          {/* Activating LiDAR lands on whatever the dataset pulldown is set to
              — the best acquisition for this view while it says Automatisk,
              the national mosaic otherwise. Entering the mode is not itself a
              dataset pick, so it leaves that setting alone. */}
          <ModeButton
            icon="landscape"
            label={t('ribbon.mode.lidar')}
            tooltip={`${t('ribbon.mode.lidarTip')} (2)`}
            active={ground.mode === 'lidar'}
            onClick={() => ground.select('lidar')}
          />

          {/* The LiDAR stack plus roads, rail and place names. Still LiDAR
              mode, so dataset, style and cycling keep working underneath. */}
          <ModeButton
            icon="signpost"
            label={t('ribbon.mode.hybrid')}
            tooltip={`${t('ribbon.mode.hybridTip')} (3)`}
            active={ground.mode === 'hybrid'}
            onClick={() => ground.select('hybrid')}
          />

          {/* Ortofoto: the seamless best-available mosaic by default, with
              every acquisition back to the 1930s in the pulldown. Hybrid is
              deliberately left alone rather than cleared — it's a LiDAR
              modifier, inert here, and switching back should return to the
              stack you left. */}
          <ModeButton
            icon="satellite_alt"
            label={t('ribbon.mode.flyfoto')}
            tooltip={`${t('ribbon.mode.flyfotoTip')} (4)`}
            active={ground.mode === 'flyfoto'}
            onClick={() => ground.select('flyfoto')}
          />

          {/* Terreng is the fifth ground and digit 5 still selects it, but its
              *button* is on the lokalitet row now (docs/lokalitet-view.md §8):
              it reads a rectangle, and the only rectangle in the app belongs
              to a lokalitet. The gap it leaves here is deliberate — four
              buttons, five positions, and `GROUND_KEYS` is positional against
              GROUND_MODES rather than against what this row draws. */}
        </div>

        {/* "Skjul merker" stood here, and it is gone rather than moved twice.
            It was global by an argument that had stopped being true: it hid
            the lokalitet rectangles *and* the funn, but the funn layer only
            ever holds the open lokalitet's, and for a signed-out visitor no
            rectangles load at all — so for half the app it was a dead button,
            and for the other half it was a switch sitting three rows away
            from the count of what it hid. The two halves went separate ways:
            the funn half is the eye on `Funn` (H still works), and the
            rectangles no longer need hiding because they draw faint unless
            they are the one you have open (localityLayer.ts). */}

        <div className={styles.divider} />

        <div className={styles.group}>
          {/* One control with a seam in it: the noun opens the panel — the
              five services, kulturminner2's registers, the rendering, the
              opacity — and the eye beside it puts the overlay on the map or
              takes it off. It was two buttons, `Kulturminner` toggling one of
              the five sources and `Oppsett` holding the rest; see
              HeritageControl for why the split was in the wrong place. */}
          <HeritageControl />
        </div>

        <div className={styles.divider} />

        <div className={styles.group}>
          {/* Stedsinfo. Beside Mål because they are the same kind of thing —
              a question you put to the map by clicking it, and a mode you
              stay in while you do. It is off on arrival: clicking used to
              interrogate every register unasked, which turned panning away
              from a click into a panel to dismiss. */}
          <ModeButton
            icon="info"
            label={t('ribbon.info.label')}
            tooltip={`${t('ribbon.info.tip')} (I)`}
            active={infoTool}
            onClick={() => setInfoTool(!infoTool)}
          />
          <RibbonMeasure />
        </div>

        {/* Signed-in-only lokalitet controls. Hidden for guests rather than
            shown-disabled; the account button is the way in. */}
        {isSignedIn && (
          <>
            <div className={styles.divider} />
            <div className={styles.group}>
              <Tooltip label={t('localities.topbar.myLocalities')}>
                <IconButton
                  icon="bookmark"
                  size="md"
                  variant={tool === 'localities' ? 'primary' : 'ghost'}
                  aria-label={t('localities.topbar.myLocalities')}
                  aria-pressed={tool === 'localities'}
                  onClick={() => toggleTool('localities')}
                />
              </Tooltip>
              <Tooltip label={t('localities.topbar.newLocality')}>
                <IconButton
                  icon="add_location_alt"
                  size="md"
                  variant="secondary"
                  disabled={creating}
                  aria-label={t('localities.topbar.newLocality')}
                  onClick={() => {
                    setTool(null);
                    createFromViewport();
                  }}
                />
              </Tooltip>
            </div>
          </>
        )}

        <div className={styles.spacer} />
        <RibbonAccount />
      </div>

      {/* The settings strip for whatever the ring above has selected. Rendered
          from here rather than as a sibling in Ribbon.tsx because it runs off
          the same control hooks, which are mounted once and only here —
          hoisting them into a context to gain a second error boundary would
          buy nothing, since a crash in either row comes from the same
          hooks. */}
      <RibbonSettingsRow
        ground={ground}
        standard={standard}
        lidar={lidar}
        flyfoto={flyfoto}
        terrain={terrain}
      />
    </>
  );
};
