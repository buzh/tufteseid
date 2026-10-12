// Children must be single boxes, not nested units: the seam rules are child
// selectors, so a nested unit takes the lapped edge on its wrapper div.

import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './ControlUnit.module.css';

export const ControlUnit = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => <div className={cx(styles.unit, className)}>{children}</div>;
