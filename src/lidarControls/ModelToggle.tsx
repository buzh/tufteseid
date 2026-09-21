// Terreng or Overflate — which of the two height models the LiDAR ground is
// drawn from.
//
// A two-state button rather than a segmented control: there are exactly two
// models and they are the same terrain seen with and without what grows on it,
// so the pair is one picture with a lid on or off. The button stacks the lid
// over the ground — a tree above the divider, a bare hill below — and lights
// the half that is drawing, which says both what is showing and what the other
// click would give in the width of one chip.

import { Tooltip, UnstyledButton } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import styles from './controls.module.css';
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
      <UnstyledButton
        className={styles.modelToggle}
        aria-label={t('lidarControls.model.aria', {
          model: isDom
            ? t('lidarControls.model.dom')
            : t('lidarControls.model.dtm'),
        })}
        aria-pressed={isDom}
        onClick={() => selectModel(isDom ? 'dtm' : 'dom')}
      >
        <span className={cx(styles.modelHalf, isDom && styles.modelHalfOn)}>
          <Icon icon="park" size={14} />
        </span>
        <span className={cx(styles.modelHalf, !isDom && styles.modelHalfOn)}>
          <Icon icon="landscape" size={14} />
        </span>
      </UnstyledButton>
    </Tooltip>
  );
};
