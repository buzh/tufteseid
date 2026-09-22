// One control made of more than one box. A toggle that puts something on the
// map and, only while it is on, the chip that says what of it: two questions,
// but one subject, and the row should say so before it is read.
//
// Joined rather than merged. The alternative was a single box with the glyph
// inside the chip, but the toggle has to stay a press with nothing to aim at
// while the chip is a menu target, and one box cannot be both. So the two keep
// their own hit areas and their own keyboard stops, and this draws them as one
// shape — shared edge, outer radius only, no gap.
//
// It styles whatever boxes stand in it rather than taking them as props: the
// children arrive already wrapped in a `Tooltip` or a `Popover.Target`, both of
// which clone their one child, so what lands in the DOM here is the button
// itself and the seam rules reach it. That is also what makes this generic —
// any two `src/ui/` boxes can stand in it, and a child that comes and goes
// leaves the survivor fully rounded on its own.

import type { ReactNode } from 'react';
import styles from './ControlUnit.module.css';

export const ControlUnit = ({ children }: { children: ReactNode }) => (
  <div className={styles.unit}>{children}</div>
);
