// The Kulturminner surface: the button that puts the heritage record over the
// ground, and the chevron that opens what of it.
//
// Two shapes rather than one chip with a toggle in its menu, because the two
// are different questions asked at different rates. Whether the register is
// over the terrain at all is asked constantly, by a reader comparing a mound in
// the relief against what is recorded there, and it has to be one press with
// nothing to read. Which registers and which render is asked once a session.
//
// But one control, so they stand in a `ControlUnit` rather than a `Group`: the
// chip is a readout of what the button turned on, and set a gap apart the two
// read as unrelated neighbours in a band whose other members genuinely are.
//
// The chevron stands whether the overlay is on or off. It once came and went
// with it, on the reasoning that a filter over an empty map means nothing — but
// it means the same thing off as on, which is what will draw when the record
// goes over the ground, and the going cost the reader the one thing a toggle
// must not cost: the box under the cursor moved as they pressed it, so the
// second press of an on-and-back-off landed somewhere else.

import { ControlUnit } from '../ui/ControlUnit';
import { HeritageMenu } from './HeritageMenu';
import { HeritageToggle } from './HeritageToggle';
import type { HeritageControls } from './useHeritageControls';

export const HeritageControlGroup = ({
  heritage,
}: {
  heritage: HeritageControls;
}) => (
  <ControlUnit>
    <HeritageToggle heritage={heritage} />
    <HeritageMenu heritage={heritage} />
  </ControlUnit>
);
