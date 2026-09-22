// The middle of the band: how the map is being looked at, rather than what it
// is drawing.
//
// One control — the view: one ground over the whole map, two under a draggable
// seam, or two panes side by side on one view. It belongs here and not in
// `GroundSection` because it chooses no ground: it says how many of them are on
// the screen, and the ground sections on either side of it say which.
//
// Which is also why this section is the hinge of the row. In a two-ground view
// the B section stands immediately to its right, so the control that put the
// second ground on the screen sits between the two grounds it governs.

import { Group } from '@mantine/core';
import { useViewControls, ViewControlGroup } from '../viewControls';
import styles from './Ribbon.module.css';

export const ViewSection = () => {
  const view = useViewControls();

  return (
    <Group gap="xs" wrap="nowrap" className={styles.views}>
      <ViewControlGroup view={view} />
    </Group>
  );
};
