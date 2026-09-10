import type { MaterialSymbol } from 'material-symbols';
import { cx } from './cx';
import styles from './Icon.module.css';

/*
 * Material Symbols glyph. The font is loaded app-wide by
 * `material-symbols/rounded.css` in src/mainApp.tsx, so this renders the
 * ligature and nothing else.
 *
 * The name union comes from the same package (`index.d.ts` — a tuple of every
 * ligature, indexed into a string union). It used to be re-exported from kvib;
 * every `MaterialSymbol` import in the app points here, so re-homing it was
 * one line. A name that is not in the union fails the docker build — §11 of
 * docs/ui-architecture.md has how to check one without local node_modules.
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
