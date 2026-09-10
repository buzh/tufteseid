import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { isSignedInAtom } from '../auth/atoms';
import { activeLocalityAtom } from '../localities/atoms';
import { useCreateLocalityFromViewport } from '../localities/createFromBbox';
import { activeThemeLayersAtom } from '../map/layers/atoms';
import type { ThemeLayerName } from '../map/layers/themeWMS';
import { type MapTool, mapToolAtom } from '../map/overlay/atoms';
import { useRegisterBackgroundCycle } from '../map/useBackgroundCyclingKeys';
import { useTerrainViewport } from '../terrain/useTerrainViewport';
import { IconButton, Tooltip } from '../ui';
import { FlyfotoDatasetPicker } from './flyfoto/FlyfotoDatasetPicker';
import { useFlyfotoControls } from './flyfoto/useFlyfotoControls';
import { LidarDatasetPicker } from './lidar/LidarDatasetPicker';
import { LidarModelToggle } from './lidar/LidarModelToggle';
import { LidarStylePicker } from './lidar/LidarStylePicker';
import { useLidarControls } from './lidar/useLidarControls';
import { ModeButton } from './ModeButton';
import { RibbonAccount } from './RibbonAccount';
import { RibbonMeasure } from './RibbonMeasure';
import { RibbonSearch } from './RibbonSearch';
import styles from './Ribbon.module.css';

/**
 * Row 1 — always present, independent of any lokalitet: what the map shows
 * and how to find a place on it.
 *
 * Left to right, and the order is the argument: find a place, choose what
 * the ground looks like (mode, then the modifiers on that mode), overlay the
 * heritage record on top of it, then the tools that act on what you are
 * looking at.
 *
 * Modes versus modifiers is the distinction to preserve here
 * (docs/ui-architecture.md §5.2). Standard, LiDAR and Flyfoto are modes.
 * Hybrid, DTM/DOM and the style pick are modifiers on the LiDAR stack —
 * which is why Hybrid activates the national mosaic when nothing LiDAR is on
 * yet rather than becoming a background of its own.
 *
 * LiDAR and Flyfoto each bring a dataset pulldown and a keyboard ring, and
 * only one of the two is ever on screen — this row is where they are
 * chained, because there is exactly one registered cycle handler.
 */
export const RibbonGlobalRow = () => {
  const { t } = useTranslation();
  const isSignedIn = useAtomValue(isSignedInAtom);
  const activeLocality = useAtomValue(activeLocalityAtom);
  const [tool, setTool] = useAtom(mapToolAtom);
  const [themeLayers, setThemeLayers] = useAtom(activeThemeLayersAtom);
  const lidar = useLidarControls();
  const flyfoto = useFlyfotoControls();
  const terrain = useTerrainViewport();

  // A/D/W/S/E. Each half declines every key outside its own mode, so the
  // order here only decides who is asked first, not who gets it. The
  // document listener lives at the shell root (useMapSideEffects).
  useRegisterBackgroundCycle((key) => flyfoto.cycle(key) || lidar.cycle(key));

  // "Ny lokalitet" frames the visible map rather than arming a box drag.
  const { create: createFromViewport, creating } =
    useCreateLocalityFromViewport();

  const toggleTool = (name: Exclude<MapTool, null>) =>
    setTool(tool === name ? null : name);

  const toggleThemeLayer = (name: ThemeLayerName) =>
    setThemeLayers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className={styles.row}>
      <RibbonSearch />

      <div className={styles.group}>
        <ModeButton
          icon="map"
          label={t('ribbon.mode.standard')}
          tooltip={t('ribbon.mode.standardTip')}
          active={lidar.backgroundLayer === 'topo'}
          onClick={() => {
            lidar.setHybridOverlay(false);
            lidar.setBackgroundLayer('topo');
          }}
        />

        {/* Activating LiDAR lands on whatever the dataset pulldown is set to
            — the best acquisition for this view while it says Automatisk,
            the national mosaic otherwise. Entering the mode is not itself a
            dataset pick, so it leaves that setting alone. */}
        <ModeButton
          icon="landscape"
          label={t('ribbon.mode.lidar')}
          tooltip={t('ribbon.mode.lidarTip')}
          active={lidar.isLidarMode && !lidar.hybridOverlay}
          onClick={() => {
            lidar.setHybridOverlay(false);
            if (!lidar.isLidarMode) lidar.enterLidar();
          }}
        />

        {/* The LiDAR stack plus roads, rail and place names. Still LiDAR
            mode, so dataset, style and cycling keep working underneath. */}
        <ModeButton
          icon="signpost"
          label={t('ribbon.mode.hybrid')}
          tooltip={t('ribbon.mode.hybridTip')}
          active={lidar.isLidarMode && lidar.hybridOverlay}
          onClick={() => {
            lidar.setHybridOverlay(true);
            if (!lidar.isLidarMode) lidar.enterLidar();
          }}
        />

        {/* Ortofoto: the seamless best-available mosaic by default, with
            every acquisition back to the 1930s in the pulldown. Hybrid is
            deliberately left alone rather than cleared — it's a LiDAR
            modifier, inert here, and switching back should return to the
            stack you left. */}
        <ModeButton
          icon="satellite_alt"
          label={t('ribbon.mode.flyfoto')}
          tooltip={t('ribbon.mode.flyfotoTip')}
          active={flyfoto.isFlyfotoMode}
          onClick={flyfoto.enterFlyfoto}
        />
      </div>

      {flyfoto.isFlyfotoMode && (
        <div className={styles.group}>
          <FlyfotoDatasetPicker flyfoto={flyfoto} />
        </div>
      )}

      {lidar.isLidarMode && (
        <div className={styles.group}>
          <LidarDatasetPicker lidar={lidar} />
          {/* Only when the dataset publishes more than one styled variant. */}
          {lidar.datasetStyles.length > 1 && <LidarStylePicker lidar={lidar} />}
          {/* Outside that guard on purpose: DOM publishes a single style, so
              the style chip disappears in DOM mode and this toggle would
              take the way back out with it. */}
          <LidarModelToggle
            model={lidar.lidarModel}
            onSelect={lidar.setLidarModel}
          />
        </div>
      )}

      <div className={styles.divider} />

      <div className={styles.group}>
        {/* One-click toggle for the most-used heritage layer; the full list
            is behind the Kartlag card next to it. */}
        <ModeButton
          icon="castle"
          label={t('ribbon.heritage.label')}
          tooltip={t('ribbon.heritage.tip')}
          active={themeLayers.has('heritageSites')}
          onClick={() => toggleThemeLayer('heritageSites')}
        />
        <ModeButton
          icon="layers"
          label={t('mapLayers.label')}
          tooltip={t('ribbon.layers.tip')}
          active={tool === 'layers'}
          badge={themeLayers.size}
          onClick={() => toggleTool('layers')}
        />
      </div>

      <div className={styles.divider} />

      <div className={styles.group}>
        <RibbonMeasure />

        {/* Terrenganalyse of the ground you are looking at: no lokalitet, no
            account. Hidden while a lokalitet is open, because row 2 carries
            the same verb scoped to its rectangle and two live controls for
            one surface would disagree about which rectangle "Lagre" keeps. */}
        {!activeLocality && (
          <ModeButton
            icon="elevation"
            label={t('ribbon.terrain.label')}
            tooltip={t('ribbon.terrain.tip')}
            active={terrain.active}
            onClick={terrain.toggle}
          />
        )}
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
  );
};
