// The top ribbon. It answers one question — what is on the screen — and lets the
// reader change the answer along the three axes the LiDAR ring has: which
// dataset, which render of it, and which model.
//
// Only the LiDAR grounds are here. Kart, Flyfoto, Amtskart and the Hybrid
// overlay are still reachable by `?backgroundLayer=` and by their atoms
// (`docs/map-layers.md`); when the ribbon grows a ground switch this row becomes
// the LiDAR arm of it.

import { Button, Group, SegmentedControl, Text, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { LidarModel } from '../map/layers/config/backgroundLayers/lidarProjects';
import { Icon } from '../ui/Icon';
import { AutoToggle } from './AutoToggle';
import { DatasetMenu } from './DatasetMenu';
import { RenderMenu } from './RenderMenu';
import styles from './Ribbon.module.css';
import { useLidarControls } from './useLidarControls';

export const Ribbon = () => {
  const { t } = useTranslation();
  const lidar = useLidarControls();

  return (
    <header className={styles.ribbon}>
      <Group gap="xs" wrap="nowrap" className={styles.group}>
        <Icon icon="landscape" size={22} className={styles.mark} />
        <Text size="sm" fw={600} className={styles.markLabel}>
          {t('ribbon.lidar')}
        </Text>

        {lidar.isLidarBackground ? (
          <>
            {/* Ahead of the pair it governs, not between them: with Automatisk
                on, both chips are its answer. */}
            <AutoToggle lidar={lidar} />
            <DatasetMenu lidar={lidar} />
            <RenderMenu lidar={lidar} />
            {/* Per segment, not around the control: the two models are two
                different pictures, and a tooltip on the pair could only
                describe one of them. */}
            <SegmentedControl
              size="xs"
              value={lidar.lidarModel}
              onChange={(value) => lidar.selectModel(value as LidarModel)}
              data={[
                {
                  value: 'dtm',
                  label: (
                    <Tooltip label={t('ribbon.model.dtmHint')}>
                      <span>{t('ribbon.model.dtm')}</span>
                    </Tooltip>
                  ),
                },
                {
                  value: 'dom',
                  label: (
                    <Tooltip label={t('ribbon.model.domHint')}>
                      <span>{t('ribbon.model.dom')}</span>
                    </Tooltip>
                  ),
                },
              ]}
            />
          </>
        ) : (
          // A cold load on `?backgroundLayer=topo` or any other ground the URL
          // still carries. The ribbon does not pretend to drive it — it says so
          // and offers the way back.
          <>
            <Text size="sm" c="dimmed">
              {t('ribbon.offLidar')}
            </Text>
            <Button size="xs" variant="light" onClick={lidar.enterLidar}>
              {t('ribbon.enterLidar')}
            </Button>
          </>
        )}
      </Group>
    </header>
  );
};
