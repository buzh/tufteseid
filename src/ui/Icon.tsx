import type { MaterialSymbol } from 'material-symbols';
import { cx } from './cx';
import styles from './Icon.module.css';

// An icon name absent from the `MaterialSymbol` union fails the build. To check
// one without local node_modules:
//   curl -sL https://registry.npmjs.org/material-symbols/-/material-symbols-0.47.2.tgz \
//     | tar xz -O package/index.d.ts | grep '"terrain"'
export type { MaterialSymbol };

export const Icon = ({
  icon,
  size = 20,
  filled,
  color,
  className,
}: {
  icon: MaterialSymbol;
  size?: number;
  filled?: boolean;
  color?: string;
  className?: string;
}) => (
  <span
    aria-hidden="true"
    translate="no"
    className={cx(
      'material-symbols-rounded',
      styles.icon,
      filled && styles.filled,
      className,
    )}
    style={{ fontSize: `${size}px`, width: size, height: size, color }}
  >
    {icon}
  </span>
);
