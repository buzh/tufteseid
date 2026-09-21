import type { MaterialSymbol } from 'material-symbols';
import { cx } from './cx';
import styles from './Icon.module.css';

// Material Symbols glyph; the font is loaded app-wide in src/mainApp.tsx, so
// this renders the ligature and nothing else. The `MaterialSymbol` union comes
// from the same package, and a plausible-looking name that is not in it fails
// the docker build. The workstation has no node_modules to check against, so:
//
//   curl -sL https://registry.npmjs.org/material-symbols/-/material-symbols-0.47.2.tgz \
//     | tar xz -O package/index.d.ts | grep '"terrain"'
//
// Known traps: `terrain`, `filter_hdr` and `topography` do not exist;
// `elevation`, `landscape` and `altitude` do.
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
