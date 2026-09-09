import type { ReactNode } from 'react';
import styles from './Badge.module.css';
import { cx } from './cx';

export type BadgePalette = 'gray' | 'green' | 'yellow' | 'red' | 'blue';

const PALETTE_CLASS: Record<BadgePalette, string> = {
  gray: styles.gray,
  green: styles.green,
  yellow: styles.yellow,
  red: styles.red,
  blue: styles.blue,
};

export const Badge = ({
  palette = 'gray',
  className,
  children,
}: {
  palette?: BadgePalette;
  className?: string;
  children: ReactNode;
}) => (
  <span className={cx(styles.badge, PALETTE_CLASS[palette], className)}>
    {children}
  </span>
);

// Nothing to say when the count is zero or unknown, so render nothing —
// call sites used to repeat this `count != null && count !== 0` guard.
export const CountBadge = ({
  count,
  palette = 'gray',
  className,
}: {
  count?: number | string | null;
  palette?: BadgePalette;
  className?: string;
}) => {
  if (count == null || count === 0 || count === '') return null;
  return (
    <span
      className={cx(
        styles.badge,
        styles.count,
        PALETTE_CLASS[palette],
        className,
      )}
    >
      {count}
    </span>
  );
};
