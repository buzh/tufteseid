// The Kulturminner surface: the button that puts the heritage record over the
// ground, and — only while it is there — the chip that says what of it.
//
// Two shapes rather than one chip with a toggle in its menu, because the two
// are different questions asked at different rates. Whether the register is
// over the terrain at all is asked constantly, by a reader comparing a mound in
// the relief against what is recorded there, and it has to be one press with
// nothing to read. Which registers and which render is asked once a session.
//
// The chip is absent while the overlay is off, not disabled: with nothing
// drawing there is no readout for it to carry, and a filter over an empty map
// is a control the reader has to turn something else on before it means
// anything.

import { Group } from '@mantine/core';
import { HeritageMenu } from './HeritageMenu';
import { HeritageToggle } from './HeritageToggle';
import type { HeritageControls } from './useHeritageControls';

export const HeritageControlGroup = ({
  heritage,
}: {
  heritage: HeritageControls;
}) => (
  <Group gap="xs" wrap="nowrap" flex="none">
    <HeritageToggle heritage={heritage} />
    {heritage.shown && <HeritageMenu heritage={heritage} />}
  </Group>
);
