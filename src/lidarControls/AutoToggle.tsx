import { Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { ControlButton } from '../ui/ControlButton';
import type { LidarControls } from './useLidarControls';

export const AutoToggle = ({ lidar }: { lidar: LidarControls }) => {
  const { t } = useTranslation();
  const { autoDataset, toggleAuto } = lidar;

  return (
    <Tooltip
      label={
        autoDataset
          ? t('lidarControls.auto.onHint')
          : t('lidarControls.auto.offHint')
      }
    >
      <ControlButton
        icon="autorenew"
        on={autoDataset}
        aria-label={t('lidarControls.auto.label')}
        aria-pressed={autoDataset}
        onClick={toggleAuto}
      />
    </Tooltip>
  );
};
