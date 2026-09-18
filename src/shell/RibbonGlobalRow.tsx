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
import { IconButton, Tooltip } from '../ui';
import { useFlyfotoControls } from './flyfoto/useFlyfotoControls';
import { groundHandleAtom } from './groundHandle';
import { HeritageControl } from './heritage/HeritageControl';
import { useLidarControls } from './lidar/useLidarControls';
import { ModeButton } from './ModeButton';
import { RibbonAccount } from './RibbonAccount';
import { RibbonLanguage } from './RibbonLanguage';
import { RibbonMeasure } from './RibbonMeasure';
import { RibbonSearch } from './RibbonSearch';
import { RibbonSettingsRow } from './RibbonSettingsRow';
import styles from './Ribbon.module.css';
import { StandardVariantPicker } from './standard/StandardVariantPicker';
import { useStandardControls } from './standard/useStandardControls';
import { useTerrainAnalysis } from './terrain/useTerrainAnalysis';
import { GROUND_MODES, useGroundMode } from './useGroundMode';
import { useRecreateView } from './useRecreateView';

/**
 * Row 1 — what the map shows and how to find a place on it, with
 * `RibbonSettingsRow` below it carrying the chosen ground's modifiers.
 *
 * The four control hooks and `useGroundMode` are mounted here and only here; a
 * second mount means a second DEM. What the sibling lokalitet row needs
 * crosses the gap on `groundHandleAtom` and `beholdOfferAtom`.
 *
 * Four of the five ground buttons are drawn here — Terreng's is on the
 * lokalitet row — but digit 5 still selects it: `GROUND_KEYS` is positional
 * against `GROUND_MODES`, not against what this row draws.
 */
export const RibbonGlobalRow = () => {
  const { t } = useTranslation();
  const isSignedIn = useAtomValue(isSignedInAtom);
  const [tool, setTool] = useAtom(mapToolAtom);
  const [infoTool, setInfoTool] = useAtom(infoToolAtom);
  const standard = useStandardControls();
  const lidar = useLidarControls();
  const flyfoto = useFlyfotoControls();
  // Nothing is written until `Opprett`, and it raises the sign-in dialog
  // itself, hence no `isSignedIn` check at either call site.
  const startPlacement = useStartLocalityPlacement();

  // Unconditional: gating it on `ground.modifiers` would throw the DEM away
  // every time someone glanced at another ground.
  const terrain = useTerrainAnalysis();
  // Terreng with nothing open places a rectangle; the tool arms at the commit.
  const ground = useGroundMode(standard, lidar, flyfoto, terrain, () => {
    startPlacement('terrain');
  });
  // Mounted here because applying a saved view writes all four control hooks.
  useRecreateView(ground, lidar, flyfoto, terrain);

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

        {/* The ring. Order is GROUND_MODES, which is also 1–5. */}
        <div className={styles.group}>
          {/* The one ground whose dataset list hangs off its own button rather
              than off the settings strip, which is why it has no strip. */}
          <div className={styles.split}>
            <ModeButton
              icon="map"
              label={t('ribbon.mode.standard')}
              tooltip={`${t('ribbon.mode.standardTip')} (1)`}
              active={ground.mode === 'standard'}
              joinedRight
              onClick={() => ground.select('standard')}
            />
            <StandardVariantPicker
              standard={standard}
              onPickGround={() => ground.select('standard')}
            />
          </div>

          {/* Lands on whatever the dataset pulldown is set to: entering the
              ground is not itself a dataset pick. */}
          <ModeButton
            icon="landscape"
            label={t('ribbon.mode.lidar')}
            tooltip={`${t('ribbon.mode.lidarTip')} (2)`}
            active={ground.mode === 'lidar'}
            onClick={() => ground.select('lidar')}
          />

          {/* The LiDAR stack plus roads, rail and place names — still LiDAR's
              modifiers underneath. */}
          <ModeButton
            icon="signpost"
            label={t('ribbon.mode.hybrid')}
            tooltip={`${t('ribbon.mode.hybridTip')} (3)`}
            active={ground.mode === 'hybrid'}
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
            active={ground.mode === 'flyfoto'}
            onClick={() => ground.select('flyfoto')}
          />

          {/* Terreng, the fifth ground, has its button on the lokalitet row.
              Four buttons, five positions. */}
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
