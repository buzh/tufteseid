import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_LIDAR_FILTERS,
  lidarFilterSettingsAtom,
} from '../../map/layers/config/backgroundLayers/lidarRelevance';
import { Button, Switch } from '../../ui';
import styles from './LidarFilters.module.css';

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Relevance filters for the dataset list. Closed by default, and safe to
 * leave that way: these rules only ever reprioritize — primary list versus
 * "mindre relevante" — and never hide data, so dialing them back always
 * reveals more of the same catalogue rather than something new.
 */
export const LidarFilters = () => {
  const { t } = useTranslation();
  const [filters, setFilters] = useAtom(lidarFilterSettingsAtom);

  const modified =
    filters.minYear !== DEFAULT_LIDAR_FILTERS.minYear ||
    !filters.grandfatherDense ||
    filters.minAreaRatio !== DEFAULT_LIDAR_FILTERS.minAreaRatio;

  return (
    <div className={styles.panel}>
      <div>
        <label className={styles.label} htmlFor="lidar-filter-year">
          {t('ribbon.lidar.filterMinYear', { year: filters.minYear })}
        </label>
        <input
          id="lidar-filter-year"
          type="range"
          className={styles.range}
          min={2000}
          max={CURRENT_YEAR}
          value={filters.minYear}
          onChange={(e) =>
            setFilters({ ...filters, minYear: Number(e.target.value) })
          }
        />
      </div>

      <Switch
        checked={filters.grandfatherDense}
        onChange={(checked) =>
          setFilters({ ...filters, grandfatherDense: checked })
        }
        label={t('ribbon.lidar.filterDense')}
      />

      <div>
        <label className={styles.label} htmlFor="lidar-filter-area">
          {t('ribbon.lidar.filterMinArea', {
            percent: Math.round(filters.minAreaRatio * 100),
          })}
        </label>
        <input
          id="lidar-filter-area"
          type="range"
          className={styles.range}
          min={0}
          max={50}
          step={5}
          value={Math.round(filters.minAreaRatio * 100)}
          onChange={(e) =>
            setFilters({
              ...filters,
              minAreaRatio: Number(e.target.value) / 100,
            })
          }
        />
      </div>

      {modified && (
        <Button
          size="xs"
          palette="gray"
          className={styles.reset}
          onClick={() => setFilters(DEFAULT_LIDAR_FILTERS)}
        >
          {t('ribbon.lidar.filterReset')}
        </Button>
      )}
    </div>
  );
};
