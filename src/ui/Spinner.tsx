import { cx } from './cx';
import styles from './Spinner.module.css';

export const Spinner = ({
  size = 16,
  label,
  className,
}: {
  size?: number;
  /** Accessible name. Omit inside a container that already announces busy. */
  label?: string;
  className?: string;
}) => (
  <span
    role={label ? 'status' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : 'true'}
    className={cx(styles.spinner, className)}
    style={{ width: size, height: size, borderWidth: Math.max(2, size / 8) }}
  />
);
