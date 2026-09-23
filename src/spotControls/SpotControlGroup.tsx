// The reader's own lokaliteter in the band: write one, or find one.
//
// One subject, two verbs, so they stand in a `ControlUnit` rather than side by
// side with a gap — the same shape the Kulturminner castle and its chevron
// wear, and for the same reason. The `+` is the press with nothing to aim at:
// it has to be one gesture, because a spot is marked while the reader is still
// looking at the thing that made them mark it. The chevron is the other
// direction, asked once in a while: which of these have I already written.
//
// The order is write then read, against the usual, because the `+` is the one
// of the two that is pressed in a hurry and it keeps the position it had when
// there was no menu at all.

import { ControlUnit } from '../ui/ControlUnit';
import { SpotMenu } from './SpotMenu';
import { SpotToggle } from './SpotToggle';

export const SpotControlGroup = () => (
  <ControlUnit>
    <SpotToggle />
    <SpotMenu />
  </ControlUnit>
);
