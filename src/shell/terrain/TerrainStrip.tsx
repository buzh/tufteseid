import { useTranslation } from 'react-i18next';
import type { DemModel } from '../../terrain/dem';
import { Segmented, Spinner, type SegmentedOption } from '../../ui';
import styles from './Terrain.module.css';
import { TerrainSliders } from './TerrainSliders';
import { TerrainVisPicker } from './TerrainVisPicker';
import type { TerrainAnalysis } from './useTerrainAnalysis';

const MODEL_OPTIONS: SegmentedOption<DemModel>[] = [
  { value: 'dtm', label: 'DTM' },
  { value: 'dom', label: 'DOM' },
];

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

      <TerrainSliders terrain={terrain} />

      <div className={styles.status}>
        {loading && <Spinner size={14} />}
        {!loading && error && (
          <span className={styles.error}>
            {t(`localities.terrain.${error}`)}
          </span>
        )}
        {/* Two readings: "0,50 m/px" alone doesn't say whether that is all the
            laser data there is or the grid cap biting, and only the capped
            case is actionable (shrink the rectangle). */}
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
    </>
  );
};
