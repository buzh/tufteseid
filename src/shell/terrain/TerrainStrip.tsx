import { useTranslation } from 'react-i18next';
import type { DemModel } from '../../terrain/dem';
import type { Visualization } from '../../terrain/shade';
import { Button, Segmented, Spinner, type SegmentedOption } from '../../ui';
import styles from './Terrain.module.css';
import type { TerrainAnalysis } from './useTerrainAnalysis';
import { VISUALIZATIONS } from './useTerrainAnalysis';

const MODEL_OPTIONS: SegmentedOption<DemModel>[] = [
  { value: 'dtm', label: 'DTM' },
  { value: 'dom', label: 'DOM' },
];

/**
 * Terrenganalyse's own settings strip: which visualization, which model, how
 * much data there turned out to be, and the two verbs. The light and the
 * opacity are the row below (TerrainSliders).
 *
 * This is the whole reason the knobs left the dock. Every other ground puts
 * its modifiers on the strip and Terreng put them in a 360 px column down the
 * side of the map — so pressing 5 moved the controls to a different part of
 * the screen, and the column covered the terrain the knobs were describing.
 * Two thin rows over the map cost less of it than one panel beside it, and
 * they are in the place the eye is already looking.
 *
 * The five visualization names carry their explanation as a native tooltip
 * rather than as a paragraph under the row: the hint is about the option you
 * are considering, not the one you already picked, and a strip has no room
 * for a sentence.
 */
export const TerrainStrip = ({ terrain }: { terrain: TerrainAnalysis }) => {
  const { t } = useTranslation();
  const { dem, loading, error } = terrain;

  const visOptions: SegmentedOption<Visualization>[] = VISUALIZATIONS.map(
    (v) => ({
      value: v,
      label: t(`localities.terrain.vis.${v}`),
      title: t(`localities.terrain.visHint.${v}`),
    }),
  );

  return (
    <>
      <Segmented
        value={terrain.vis}
        options={visOptions}
        onChange={terrain.setVis}
        label={t('localities.terrain.visualization')}
      />
      <Segmented
        value={terrain.model}
        options={MODEL_OPTIONS}
        onChange={terrain.setModel}
        label={t('ribbon.lidar.modelLabel')}
      />

      <div className={styles.status}>
        {loading && <Spinner size={14} />}
        {!loading && error && (
          <span className={styles.error}>
            {t(`localities.terrain.${error}`)}
          </span>
        )}
        {/* Two readings, because "0,50 m/px" alone doesn't say whether that
            is all the laser data there is or the grid cap biting. Only the
            second is actionable — shrink the rectangle and you get more
            detail — so it's the one that names the source. */}
        {!loading && !error && dem && (
          <span>
            {dem.metresPerPx > dem.nativeMetresPerPx * 1.05
              ? t('localities.terrain.resolutionCapped', {
                  m: dem.metresPerPx.toFixed(2),
                  w: dem.width,
                  h: dem.height,
                  src: dem.nativeMetresPerPx.toFixed(2),
                })
              : t('localities.terrain.resolution', {
                  m: dem.metresPerPx.toFixed(2),
                  w: dem.width,
                  h: dem.height,
                })}
          </span>
        )}
      </div>

      <div className={styles.actions}>
        {/* Moves the analysed rectangle onto the map as it now stands. The
            bbox is deliberately held rather than tracking the view — the DEM
            behind it is a real download, not a tile request — so panning off
            it is a normal move, and this is how you bring the analysis back
            to what you are looking at. Only without a lokalitet: with one the
            rectangle is the lokalitet's, and "Juster området" owns it. */}
        {!terrain.hasLocality && (
          <Button
            size="sm"
            variant="ghost"
            leftIcon="filter_center_focus"
            title={t('localities.terrain.reframeHint')}
            onClick={terrain.frame}
          >
            {t('localities.terrain.reframe')}
          </Button>
        )}
        {/* The verb stays put through a reload rather than appearing with the
            render, so the row does not reflow under the pointer — but there
            is nothing to keep until a DEM is painted, and the canvas may
            still be holding the previous rectangle. */}
        <Button
          size="sm"
          variant="secondary"
          disabled={terrain.saving || loading || !dem}
          onClick={terrain.save}
        >
          {terrain.saving
            ? t('localities.terrain.saving')
            : terrain.hasLocality
              ? t('localities.terrain.save')
              : t('localities.terrain.saveNew')}
        </Button>
      </div>
    </>
  );
};
