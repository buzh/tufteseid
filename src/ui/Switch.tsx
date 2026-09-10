import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './Switch.module.css';

export const Switch = ({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
}) => (
  <label className={cx(styles.root, className)}>
    <input
      type="checkbox"
      role="switch"
      className={styles.input}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span className={styles.track}>
      <span className={styles.thumb} />
    </span>
    {label}
  </label>
);
