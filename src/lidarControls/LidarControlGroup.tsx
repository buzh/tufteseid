// The LiDAR control surface: four elements in one row, and the one fallback
// they need.
//
// This is the whole surface, not a convenience wrapper — a host renders this
// and gets the controls, the order and the off-LiDAR branch, rather than
// reassembling them. The order is an argument: Automatisk stands ahead of the
// pair it governs, because with it on both chips are its answer rather than the
// reader's; the dataset comes before the render because a render is only on
// offer where the dataset publishes it; the model sits last because it is the
// one axis that survives every dataset.
//
// It takes the controller rather than calling `useLidarControls` itself. That
// is the seam a second instance goes through: see the note at the top of
// `useLidarControls.ts` for what a split view would have to do about the fact
// that there is currently only one.

import { Button, Group, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { AutoToggle } from './AutoToggle';
import styles from './controls.module.css';
import { DatasetMenu } from './DatasetMenu';
import { ModelToggle } from './ModelToggle';
import { RenderMenu } from './RenderMenu';
import type { LidarControls } from './useLidarControls';

export const LidarControlGroup = ({ lidar }: { lidar: LidarControls }) => {
  const { t } = useTranslation();

  // A cold load on `?backgroundLayer=topo` or any other ground the URL still
  // carries. The controls do not pretend to drive it — they say so and offer
  // the way back.
  if (!lidar.isLidarBackground) {
    return (
      <Group gap="xs" wrap="nowrap" className={styles.group}>
        <Text size="sm" c="dimmed">
          {t('lidarControls.offLidar')}
        </Text>
        <Button size="xs" variant="light" onClick={lidar.enterLidar}>
          {t('lidarControls.enterLidar')}
        </Button>
      </Group>
    );
  }

  return (
    <Group gap="xs" wrap="nowrap" className={styles.group}>
      <AutoToggle lidar={lidar} />
      <DatasetMenu lidar={lidar} />
      <RenderMenu lidar={lidar} />
      <ModelToggle lidar={lidar} />
    </Group>
  );
};
