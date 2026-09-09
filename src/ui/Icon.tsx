import type { MaterialSymbol } from '@kvib/react';
import { cx } from './cx';
import styles from './Icon.module.css';

/*
 * Material Symbols glyph. The font is already loaded app-wide —
 * `material-symbols/rounded.css` is imported directly in src/mainApp.tsx,
 * not pulled in by kvib — so this renders the ligature and nothing else.
 *
 * The MaterialSymbol union is still re-exported from kvib. That is the one
 * remaining kvib import in src/ui/, kept in a single place on purpose: when
 * kvib is dropped, `material-symbols` becomes a direct dependency and the
 * union is re-homed here, and this file is the only edit.
 */
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
