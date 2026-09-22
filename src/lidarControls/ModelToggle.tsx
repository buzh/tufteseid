// Terreng or Overflate — which of the two height models the LiDAR ground is
// drawn from.
//
// A two-state button rather than a segmented control: there are exactly two
// models and they are the same terrain seen with and without what grows on it,
// so the pair is one picture with a lid on or off. The split face stacks the lid
// over the ground — a tree above the divider, a bare hill below — and lights the
// half that is drawing, which says both what is showing and what the other click
// would give in the width of one chip.

import { Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { ControlButton } from '../ui/ControlButton';
import type { LidarControls } from './useLidarControls';

export const ModelToggle = ({ lidar }: { lidar: LidarControls }) => {
  const { t } = useTranslation();
  const { lidarModel, selectModel } = lidar;

  const isDom = lidarModel === 'dom';

  return (
    // What the click does, not what is showing: the lit half already says the
    // latter, and the model it would switch to is the thing no glyph can carry.
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
