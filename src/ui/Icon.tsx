import type { MaterialSymbol } from 'material-symbols';
import { cx } from './cx';
import styles from './Icon.module.css';

// Material Symbols glyph; the font is loaded app-wide in src/mainApp.tsx, so
// this renders the ligature and nothing else. The `MaterialSymbol` union
// comes from the same package — a name that is not in it fails the docker
// build; docs/ui-architecture.md, "Icons and the build gotcha", has how to
// check a name without local node_modules.
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
