// The top band. It answers one question — what is on the screen — and hosts the
// surface that lets the reader change the answer.
//
// The controls themselves are `src/lidarControls/`, because they are a surface
// and this is a place to put one: a pane in a split view would mount the same
// group against its own controller. What belongs to the band and not to the
// group is here — the wordmark that says which ring these controls are for, and
// the upstream fault chip, which is about the map rather than about LiDAR.
//
// Only the LiDAR grounds have controls so far. Kart, Flyfoto, Amtskart and the
// Hybrid overlay are still reachable by `?backgroundLayer=` and by their atoms
// (`docs/map-layers.md`); when the band grows a ground switch, the LiDAR group
// becomes one arm of it.

import { Group, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { LidarControlGroup, useLidarControls } from '../lidarControls';
import { Icon } from '../ui/Icon';
import styles from './Ribbon.module.css';
import { UpstreamStatus } from './UpstreamStatus';

export const Ribbon = () => {
  const { t } = useTranslation();
  // The app's one LiDAR controller. Mounted here rather than inside the group,
  // so the group stays something a second host could mount — see the note at
  // the top of `useLidarControls.ts`.
  const lidar = useLidarControls();

  return (
    <header className={styles.ribbon}>
      <Group gap="xs" wrap="nowrap" className={styles.group}>
        <Icon icon="landscape" size={22} className={styles.mark} />
        <Text size="sm" fw={600} className={styles.markLabel}>
          {t('ribbon.lidar')}
        </Text>

        <LidarControlGroup lidar={lidar} />

        {/* Outside the group: the topo ground under everything and the
            Kulturminner themes over it are drawn whichever dataset the LiDAR
            ring is on, so their outages have to be sayable off-LiDAR too. */}
        <UpstreamStatus />
      </Group>
    </header>
  );
};
