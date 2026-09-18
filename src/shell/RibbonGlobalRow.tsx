import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { isSignedInAtom } from '../auth/atoms';
import { type BeholdOffer, beholdOfferAtom } from '../localities/behold';
import { useStartLocalityPlacement } from '../localities/placement';
import { infoToolAtom } from '../map/featureInfo/infoTool';
import { type MapTool, mapToolAtom } from '../map/overlay/atoms';
import {
  useRegisterBackgroundCycle,
  useRegisterGroundKeys,
} from '../map/useBackgroundCyclingKeys';
import { IconButton, toast, Tooltip } from '../ui';
import { useFlyfotoControls } from './flyfoto/useFlyfotoControls';
import { groundHandleAtom } from './groundHandle';
import { HeritageControl } from './heritage/HeritageControl';
import { KartVariantPicker } from './kart/KartVariantPicker';
import { useKartControls } from './kart/useKartControls';
import { useLidarControls } from './lidar/useLidarControls';
import { ModeButton } from './ModeButton';
import { RibbonAccount } from './RibbonAccount';
import { RibbonLanguage } from './RibbonLanguage';
import { RibbonMeasure } from './RibbonMeasure';
import { RibbonSearch } from './RibbonSearch';
import { RibbonSettingsRow } from './RibbonSettingsRow';
import styles from './Ribbon.module.css';
import { useTerrainAnalysis } from './terrain/useTerrainAnalysis';
import {
  GROUND_MODES,
  type GroundMode,
  useGroundMode,
} from './useGroundMode';
import { useRecreateView } from './useRecreateView';

/**
 * Row 1 — what the map shows and how to find a place on it, with
 * `RibbonSettingsRow` below it carrying the chosen ground's modifiers.
 *
 * The four control hooks and `useGroundMode` are mounted here and only here; a
 * second mount means a second DEM. What the sibling lokalitet row needs
 * crosses the gap on `groundHandleAtom` and `beholdOfferAtom`.
 *
 * All five grounds are drawn here, in `GROUND_MODES` order, which is also
 * 1–5 — `GROUND_KEYS` in `useBackgroundCyclingKeys` is positional against that
 * array.
 */
export const RibbonGlobalRow = () => {
  const { t } = useTranslation();
  const isSignedIn = useAtomValue(isSignedInAtom);
  const [tool, setTool] = useAtom(mapToolAtom);
  const [infoTool, setInfoTool] = useAtom(infoToolAtom);
  const kart = useKartControls();
  const lidar = useLidarControls();
  const flyfoto = useFlyfotoControls();
  // Nothing is written until `Opprett`, and it raises the sign-in dialog
  // itself, hence no `isSignedIn` check at the call site.
  const startPlacement = useStartLocalityPlacement();

  // Unconditional: gating it on `ground.modifiers` would throw the DEM away
  // every time someone glanced at another ground.
  const terrain = useTerrainAnalysis();
  const ground = useGroundMode(kart, lidar, flyfoto, terrain, () => {
    toast.error({ title: t('ribbon.terrain.unavailable') });
  });
  // Mounted here because applying a saved view writes all four control hooks.
  useRecreateView(ground, lidar, flyfoto, terrain);

  const lit = (mode: GroundMode) => ground.mode === mode && !ground.covered;

  // A/D/W/S/E. Exactly one registered handler: `useGroundMode.cycle` routes
  // them rather than each ring registering and racing the others.
  useRegisterBackgroundCycle(ground.cycle);
  // 1–5 and hold-X, positional against GROUND_MODES.
  useRegisterGroundKeys({
    select: (position) => ground.select(GROUND_MODES[position - 1]),
    peekStart: ground.peekStart,
    peekEnd: ground.peekEnd,
  });

  // Through a ref so the atom is written only when `mode` or `half` changes:
  // publishing the fresh closures would re-render the lokalitet row on every
  // keystroke in the search field above it.
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
    // Cleared on unmount, so a crash into this row's boundary takes the
    // sibling row's buttons with it rather than leaving them clickable.
    return () => setGroundHandle(null);
  }, [groundMode, groundHalf, setGroundHandle]);

  // What the ground on screen offers `Behold`, published across the sibling
  // gap. A dataset name except under terrain, which carries a callback.
  const setBeholdOffer = useSetAtom(beholdOfferAtom);
  // Destructured: the control objects are fresh every render.
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
        // Both unkeepable. Hybrid's roads-and-names overlay is a separate
        // layer the extract path cannot see, so a keep would hand back a bare
        // hillshade under the name of the view being read.
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
  // Row 1 outlives every lokalitet, so nothing clears the offer on unmount.

  const toggleTool = (name: Exclude<MapTool, null>) =>
    setTool(tool === name ? null : name);

  return (
    <>
      <div className={styles.row}>
        <RibbonSearch />

        {/* The ring. Order is GROUND_MODES, which is also 1–5. Every button
            reads through `lit`, so the whole ring goes dark together while an
            arrival cover is on the ground. */}
        <div className={styles.group}>
          {/* First, and the ground a cold load arrives on: relief is the thing
              being read here. Lands on whatever the dataset pulldown is set
              to — entering the ground is not itself a dataset pick. */}
          <ModeButton
            icon="landscape"
            label={t('ribbon.mode.lidar')}
            tooltip={`${t('ribbon.mode.lidarTip')} (1)`}
            active={lit('lidar')}
            onClick={() => ground.select('lidar')}
          />

          {/* The one ground whose dataset list hangs off its own button rather
              than off the settings strip, which is why it has no strip. */}
          <div className={styles.split}>
            <ModeButton
              icon="map"
              label={t('ribbon.mode.kart')}
              tooltip={`${t('ribbon.mode.kartTip')} (2)`}
              active={lit('kart')}
              joinedRight
              onClick={() => ground.select('kart')}
            />
            <KartVariantPicker
              kart={kart}
              onPickGround={() => ground.select('kart')}
            />
          </div>

          {/* The LiDAR stack plus roads, rail and place names — still LiDAR's
              modifiers underneath. */}
          <ModeButton
            icon="signpost"
            label={t('ribbon.mode.hybrid')}
            tooltip={`${t('ribbon.mode.hybridTip')} (3)`}
            active={lit('hybrid')}
            onClick={() => ground.select('hybrid')}
          />

          {/* Ortofoto: the seamless mosaic by default, every acquisition back
              to the 1930s in the pulldown. Hybrid is left set rather than
              cleared — it is inert here, and switching back should return to
              the stack you left. */}
          <ModeButton
            icon="satellite_alt"
            label={t('ribbon.mode.flyfoto')}
            tooltip={`${t('ribbon.mode.flyfotoTip')} (4)`}
            active={lit('flyfoto')}
            onClick={() => ground.select('flyfoto')}
          />

          {/* The one ground the client computes rather than fetches, so it is
              the one bounded by a rectangle: an open lokalitet's, or a window
              framed on the visible map and clamped into the same band.
              Disabled rather than hidden on the curtain's B half — a render
              covers the whole map and cannot be one side of a split — so the
              ring does not reflow as you flip A|B. */}
          <ModeButton
            icon="elevation"
            label={t('ribbon.terrain.label')}
            tooltip={
              ground.half === 'b'
                ? t('ribbon.compare.noTerrainRight')
                : `${t('ribbon.terrain.tip')} (5)`
            }
            active={lit('terreng')}
            disabled={ground.half === 'b'}
            onClick={() => ground.select('terreng')}
          />
        </div>

        <div className={styles.divider} />

        <div className={styles.group}>
          {/* One control with a seam, the lokalitet row's `[thing ▾]`: the
              noun puts the overlay on the map or takes it off, the caret
              opens the panel. */}
          <HeritageControl />
        </div>

        <div className={styles.divider} />

        <div className={styles.group}>
          {/* Stedsinfo, beside Mål: both are questions put to the map by
              clicking it. Off on arrival, so a click asks nothing unarmed. */}
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
                  aria-label={t('localities.topbar.newLocality')}
                  onClick={() => startPlacement()}
                />
              </Tooltip>
            </div>
          </>
        )}

        <div className={styles.spacer} />
        {/* Before the account button rather than inside its pulldown: that
            pulldown is a plain `Logg inn` for a guest, and the language is
            not a signed-in setting. */}
        <RibbonLanguage />
        <RibbonAccount />
      </div>

      {/* The settings strip for whatever the ring above has selected — absent
          under Kart. Rendered from here rather than as a sibling in Ribbon.tsx
          because it runs off the same control hooks. */}
      <RibbonSettingsRow
        ground={ground}
        lidar={lidar}
        flyfoto={flyfoto}
        terrain={terrain}
      />
    </>
  );
};
