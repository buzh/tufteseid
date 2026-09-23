import { Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { ControlButton } from '../ui/ControlButton';
import type { LidarControls } from './useLidarControls';

export const ModelToggle = ({ lidar }: { lidar: LidarControls }) => {
  const { t } = useTranslation();
  const { lidarModel, selectModel } = lidar;

  const isDom = lidarModel === 'dom';

  return (
    <Tooltip
      label={
        isDom ? t('lidarControls.model.toDtm') : t('lidarControls.model.toDom')
      }
    >
      <ControlButton
        split={['park', 'landscape']}
        lit={isDom ? 'upper' : 'lower'}
        aria-label={t('lidarControls.model.aria', {
          model: isDom
            ? t('lidarControls.model.dom')
            : t('lidarControls.model.dtm'),
        })}
        aria-pressed={isDom}
        onClick={() => selectModel(isDom ? 'dtm' : 'dom')}
      />
    </Tooltip>
  );
};
