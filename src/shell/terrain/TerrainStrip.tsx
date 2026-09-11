import { useTranslation } from 'react-i18next';
import type { DemModel } from '../../terrain/dem';
import { Segmented, Spinner, type SegmentedOption } from '../../ui';
import styles from './Terrain.module.css';
import { TerrainVisPicker } from './TerrainVisPicker';
import type { TerrainAnalysis } from './useTerrainAnalysis';

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
 * The eight visualizations are a pulldown with a W/S ring rather than a
 * segmented control — TerrainVisPicker, and the argument is there. They were a
 * segmented control while there were five of them, which is about as many long
 * Norwegian names as this row can hold.
 */
export const TerrainStrip = ({ terrain }: { terrain: TerrainAnalysis }) => {
  const { t } = useTranslation();
  const { dem, loading, error } = terrain;

  return (
    <>
      <TerrainVisPicker terrain={terrain} />
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

      {/* No actions on this strip any more. It used to carry two — "Flytt
          analysen hit" and a "Lagre" that turned the analysed rectangle into
          a lokalitet — and both belonged to the standalone entrance, which is
          gone (docs/lokalitet-view.md §8). The rectangle is the lokalitet's
          and "Juster området" owns it; keeping the render is `Behold` on the
          lokalitet row, like every other ground's. What is left here is what
          the strip was always for: knobs, and what the DEM says about
          itself. */}
    </>
  );
};
