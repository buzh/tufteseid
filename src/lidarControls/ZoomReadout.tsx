

import { Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { ControlChip } from '../ui/ControlChip';
import type { LidarControls } from './useLidarControls';

export const ZoomReadout = ({ lidar }: { lidar: LidarControls }) => {
  const { t } = useTranslation();
  const { nativeResolution, magnification } = lidar;

  if (nativeResolution == null || magnification < 2) return null;

  const title = t('lidarControls.zoom.title', {
    factor: magnification,
    m: nativeResolution.toFixed(2),
  });

  return (
    <Tooltip label={title}>
      <ControlChip
        icon="zoom_in"
        label={t('lidarControls.zoom.factor', { factor: magnification })}
        aria-label={title}
        withChevron={false}
        readout
        on
      />
    </Tooltip>
  );
};
