// One subject made of more than one box. A toggle that puts something on the
// map and, only while it is on, the chip that says what of it; or a whole arm —
// several questions about one ground, which the row should say belong together
// before any of them is read.
//
// Joined rather than merged. The alternative was a single box with the glyph
// inside the chip, but a toggle has to stay a press with nothing to aim at
// while a chip is a menu target, and one box cannot be both. So each keeps its
// own hit area and its own keyboard stop, and this draws them as one shape —
// shared edges, outer radius only, no gaps.
//
// It styles whatever boxes stand in it rather than taking them as props: the
// children arrive already wrapped in a `Tooltip` or a `Popover.Target`, both of
// which clone their one child, so what lands in the DOM here is the button
// itself and the seam rules reach it. That is also what makes this generic —
// any run of `src/ui/` boxes can stand in it, and a child that comes and goes
// leaves the survivors correctly rounded on their own.
//
// Boxes, though, not units: the rules below are child selectors, so a unit
// nested in a unit takes the lapped edge on a bare div while the boxes inside
// it keep their corners. A component contributing more than one box to someone
// else's unit hands them up in a Fragment (`HybridToggle`).

import type { ReactNode } from 'react';
import styles from './ControlUnit.module.css';

export const ControlUnit = ({ children }: { children: ReactNode }) => (
  <div className={styles.unit}>{children}</div>
);
