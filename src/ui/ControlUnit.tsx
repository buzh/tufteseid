// Children must be single boxes, not nested units: the seam rules are child
// selectors, so a nested unit takes the lapped edge on its wrapper div.

import type { ReactNode } from 'react';
import styles from './ControlUnit.module.css';

export const ControlUnit = ({ children }: { children: ReactNode }) => (
  <div className={styles.unit}>{children}</div>
);
