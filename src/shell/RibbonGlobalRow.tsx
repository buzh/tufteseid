import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { isSignedInAtom } from '../auth/atoms';
import { useCreateLocalityFromViewport } from '../localities/createFromBbox';
import { mapAtom } from '../map/atoms';
import { activeThemeLayersAtom } from '../map/layers/atoms';
import type { ThemeLayerName } from '../map/layers/themeWMS';
import { type MapTool, mapToolAtom } from '../map/overlay/atoms';
import { IconButton, Tooltip } from '../ui';
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
 * (docs/ui-architecture.md §5.2). Standard and LiDAR are modes. Hybrid,
 * DTM/DOM and the style pick are modifiers on the LiDAR stack — which is why
 * Hybrid activates the national mosaic when nothing LiDAR is on yet rather
 * than becoming a background of its own.
 */
export const RibbonGlobalRow = () => {
  const { t } = useTranslation();
  const isSignedIn = useAtomValue(isSignedInAtom);
  const [tool, setTool] = useAtom(mapToolAtom);
  const [themeLayers, setThemeLayers] = useAtom(activeThemeLayersAtom);
  const map = useAtomValue(mapAtom);
  const lidar = useLidarControls();

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

  // External hop to Norge i bilder at the same extent. Their SPA reads
  // xmin/ymin/xmax/ymax + wkid from the query string (verified against
  // their bundle) and defaults wkid to 25833, matching our projection.
  //
  // Temporary. This goes away when flyfoto becomes a background mode of its
  // own; navigating out of the app to look at imagery we can render in
  // place is not something to keep.
  const openInNorgeIBilder = () => {
    const size = map.getSize();
    if (!size) return;
    const extent = map.getView().calculateExtent(size);
    if (!extent) return;
    const wkid = map
      .getView()
      .getProjection()
      .getCode()
      .replace(/^EPSG:/, '');
    const url =
      `https://norgeibilder.no/?wkid=${wkid}` +
      `&xmin=${extent[0]}&ymin=${extent[1]}` +
      `&xmax=${extent[2]}&ymax=${extent[3]}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

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

        {/* Activating LiDAR defaults to the national mosaic; the pulldown
            below swaps to a specific per-project dataset. */}
        <ModeButton
          icon="landscape"
          label={t('ribbon.mode.lidar')}
          tooltip={t('ribbon.mode.lidarTip')}
          active={lidar.isLidarMode && !lidar.hybridOverlay}
          onClick={() => {
            lidar.setHybridOverlay(false);
            if (!lidar.isLidarMode) lidar.activateNational();
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
            if (!lidar.isLidarMode) lidar.activateNational();
          }}
        />
      </div>

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
        <ModeButton
          icon="photo_camera"
          label={t('ribbon.flyfoto.label')}
          tooltip={t('ribbon.flyfoto.tip')}
          onClick={openInNorgeIBilder}
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
  );
};
