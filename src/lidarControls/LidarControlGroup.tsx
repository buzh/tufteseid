// The LiDAR arm: four elements in one row.
//
// This is the whole surface, not a convenience wrapper — a host renders this
// and gets the controls and their order rather than reassembling them. It
// assumes LiDAR is the ground: the host mounts it only under `mode === 'lidar'`
// (`src/grounds/`), so there is no off-LiDAR branch in here and no way in from
// one. The order is an argument: Automatisk stands ahead of the
// pair it governs, because with it on both chips are its answer rather than the
// reader's; the dataset comes before the render because a render is only on
// offer where the dataset publishes it; the model sits last because it is the
// one axis that survives every dataset.
//
// It takes the controller rather than calling `useLidarControls` itself. That
// is the seam a second instance goes through: see the note at the top of
// `useLidarControls.ts` for what a split view would have to do about the fact
// that there is currently only one.

import { Group } from '@mantine/core';
import { useEffect } from 'react';
import { AutoToggle } from './AutoToggle';
import styles from './controls.module.css';
import { DatasetMenu } from './DatasetMenu';
import { ModelToggle } from './ModelToggle';
import { RenderMenu } from './RenderMenu';
import type { LidarControls } from './useLidarControls';

export const LidarControlGroup = ({ lidar }: { lidar: LidarControls }) => {
  // `lidarPickerOpenAtom` is shared with the map, and an unmount never fires
  // the dataset menu's own close callback. It hangs off this group rather than
  // off the controller because the group is what comes and goes: the controller
  // outlives a trip to another ground, and a picker left open would have the
  // map painting footprints over that ground and the menu springing open
  // unprompted on the way back.
  const { setPickerOpen, setHoveredProjectId } = lidar;
  useEffect(
    () => () => {
      setPickerOpen(false);
      setHoveredProjectId(null);
    },
    [setPickerOpen, setHoveredProjectId],
  );

  return (
    <Group gap="xs" wrap="nowrap" className={styles.group}>
      <AutoToggle lidar={lidar} />
      <DatasetMenu lidar={lidar} />
      <RenderMenu lidar={lidar} />
      <ModelToggle lidar={lidar} />
    </Group>
  );
};
