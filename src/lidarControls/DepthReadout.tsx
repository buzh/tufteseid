// Past a ground's deepest level OpenLayers stretches the last tiles it holds,
// and `interpolate: false` draws that as square blocks — which reads as terrain
// unless something says otherwise. The chip is absent at 1:1, so its appearing
// is the signal; the cached ground brings it on a zoom step earlier than the
// mosaic wherever an acquisition only reaches z15.

import { Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { ControlChip } from '../ui/ControlChip';
import type { LidarControls } from './useLidarControls';

export const DepthReadout = ({ lidar }: { lidar: LidarControls }) => {
  const { t } = useTranslation();
  const { nativeResolution, magnification } = lidar;

  if (nativeResolution == null || magnification < 2) return null;

  const title = t('lidarControls.depth.title', {
    factor: magnification,
    m: nativeResolution.toFixed(2),
  });

  return (
    <Tooltip label={title}>
      <ControlChip
        icon="grid_on"
        label={t('lidarControls.depth.factor', { factor: magnification })}
        aria-label={title}
        withChevron={false}
        readout
      />
    </Tooltip>
  );
};
