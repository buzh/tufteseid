import { useTranslation } from 'react-i18next';
import type { LidarModel } from '../../map/layers/config/backgroundLayers/lidarProjects';
import { Segmented, type SegmentedOption, Tooltip } from '../../ui';

// Terrain model vs surface model. A modifier on the LiDAR stack, not a
// fourth mode — docs/ui-architecture.md §5.2.
const OPTIONS: SegmentedOption<LidarModel>[] = [
  { value: 'dtm', label: 'DTM' },
  { value: 'dom', label: 'DOM' },
];

export const LidarModelToggle = ({
  model,
  onSelect,
}: {
  model: LidarModel;
  onSelect: (model: LidarModel) => void;
}) => {
  const { t } = useTranslation();
  return (
    <Tooltip label={t('ribbon.lidar.modelTip')}>
      <Segmented
        value={model}
        options={OPTIONS}
        onChange={onSelect}
        label={t('ribbon.lidar.modelLabel')}
      />
    </Tooltip>
  );
};
