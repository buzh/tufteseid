import type { MaterialSymbol } from 'material-symbols';
import { cx } from './cx';
import styles from './Icon.module.css';

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
