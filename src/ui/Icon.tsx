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
}) => {
  // `size` is the small UI's pixels; `--ui-scale` is the reader's preference
  // (`src/ui/uiScale.ts`), which a bare number would not answer to.
  const box = `calc(${size}px * var(--ui-scale))`;
  return (
    <span
      aria-hidden="true"
      translate="no"
      className={cx(
        'material-symbols-rounded',
        styles.icon,
        filled && styles.filled,
        className,
      )}
      style={{ fontSize: box, width: box, height: box, color }}
    >
      {icon}
    </span>
  );
};
