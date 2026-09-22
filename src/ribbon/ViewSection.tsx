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
//
// It has the band's middle column and so needs no width of its own: `Ribbon`
// holds it on the centre line of the row, and it is the one control there that
// does not move when a section beside it grows one.

import { Group } from '@mantine/core';
import { useViewControls, ViewControlGroup } from '../viewControls';

export const ViewSection = () => {
  const view = useViewControls();

  return (
    <Group gap="xs" wrap="nowrap">
      <ViewControlGroup view={view} />
    </Group>
  );
};
