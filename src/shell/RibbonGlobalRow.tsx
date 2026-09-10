import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { isSignedInAtom } from '../auth/atoms';
import { marksHiddenAtom } from '../localities/atoms';
import { useCreateLocalityFromViewport } from '../localities/createFromBbox';
import { activeThemeLayersAtom } from '../map/layers/atoms';
import type { ThemeLayerName } from '../map/layers/themeWMS';
import { type MapTool, mapToolAtom } from '../map/overlay/atoms';
import {
  useRegisterBackgroundCycle,
  useRegisterGroundKeys,
} from '../map/useBackgroundCyclingKeys';
import { useTerrainViewport } from '../terrain/useTerrainViewport';
import { IconButton, Tooltip } from '../ui';
import { CompareControl } from './compare/CompareControl';
import { useFlyfotoControls } from './flyfoto/useFlyfotoControls';
import { useLidarControls } from './lidar/useLidarControls';
import { ModeButton } from './ModeButton';
import { RibbonAccount } from './RibbonAccount';
import { RibbonMeasure } from './RibbonMeasure';
import { RibbonSearch } from './RibbonSearch';
import { RibbonSettingsRow } from './RibbonSettingsRow';
import styles from './Ribbon.module.css';
import { GROUND_MODES, useGroundMode } from './useGroundMode';

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
 * LiDAR is on. Both come from this component because both run off the two
 * control hooks below, which are mounted once and only here.
 *
 * The five ground buttons are one ring, in digit order, driven by
 * useGroundMode — including Terreng, which is a render over the background
 * rather than a background of its own but is a *ground* as far as the person
 * reading it is concerned. Hybrid is the odd one out and stays a mode here on
 * purpose: it is a modifier on the LiDAR stack (which is why picking it
 * activates the national mosaic when nothing LiDAR is on yet), but it is also
 * one of the five things you flip between, and splitting the ring to say so
 * would cost more than it explains. DTM/DOM and the style pick remain
 * modifiers and stay on the settings strip. docs/ui-architecture.md §5.2.
 *
 * LiDAR and Flyfoto each bring a dataset pulldown and a keyboard ring, and
 * only one of the two is ever on screen — this component is where they are
 * chained, because there is exactly one registered cycle handler. The
 * pulldowns themselves render on the strip.
 *
 * Sammenlign sits beside the ring rather than in it: it does not answer
 * "what does the ground look like" but "against what", and it needs the
 * ring's current and previous mode to pick a sensible other half.
 */
export const RibbonGlobalRow = () => {
  const { t } = useTranslation();
  const isSignedIn = useAtomValue(isSignedInAtom);
  const [tool, setTool] = useAtom(mapToolAtom);
  const [marksHidden, setMarksHidden] = useAtom(marksHiddenAtom);
  const [themeLayers, setThemeLayers] = useAtom(activeThemeLayersAtom);
  const lidar = useLidarControls();
  const flyfoto = useFlyfotoControls();
  const terrain = useTerrainViewport();
  const ground = useGroundMode(lidar, flyfoto, terrain);

  // A/D/W/S/E. useGroundMode routes them to the ring of the ground on screen;
  // there is exactly one registered handler, so the two halves compose there
  // rather than each registering. The document listener lives at the shell
  // root (useMapSideEffects).
  useRegisterBackgroundCycle(ground.cycle);
  // 1–5 and hold-X, against the same button order rendered below.
  useRegisterGroundKeys({
    select: (position) => ground.select(GROUND_MODES[position - 1]),
    peekStart: ground.peekStart,
    peekEnd: ground.peekEnd,
  });

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

          {/* Terrenganalyse: relief computed here from float elevation, over
              the lokalitet's rectangle when one is open and over the visible
              map otherwise. It stays on the bar with a lokalitet open — the
              lokalitet row used to carry a second copy of this verb, and the
              two disagreeing about which rectangle "Lagre" keeps is exactly
              why there is one control now. */}
          <ModeButton
            icon="elevation"
            label={t('ribbon.terrain.label')}
            tooltip={`${t('ribbon.terrain.tip')} (5)`}
            active={ground.mode === 'terreng'}
            onClick={() => ground.select('terreng')}
          />
        </div>

        <div className={styles.group}>
          <CompareControl mode={ground.mode} previous={ground.previous} />
          {/* Beside Sammenlign because it answers the question that comes up
              the moment you have two acquisitions of the same ground side by
              side: is that bump real, or is it my own outline? Global rather
              than a lokalitet verb — the rectangles are on the map whether
              or not a lokalitet is open, and hiding them is a way of looking,
              not something you do to a lokalitet. */}
          <ModeButton
            icon="visibility_off"
            label={t('ribbon.marks.label')}
            tooltip={`${t('ribbon.marks.tip')} (H)`}
            active={marksHidden}
            onClick={() => setMarksHidden(!marksHidden)}
          />
        </div>

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
          the same two control hooks, which are mounted once and only here —
          hoisting them into a context to gain a second error boundary would
          buy nothing, since a crash in either row comes from the same
          hooks. */}
      <RibbonSettingsRow ground={ground} lidar={lidar} flyfoto={flyfoto} />
    </>
  );
};
