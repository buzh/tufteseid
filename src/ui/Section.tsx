import type { ReactNode } from 'react';
import { useId } from 'react';
import { type BadgePalette, CountBadge } from './Badge';
import { cx } from './cx';
import { Icon } from './Icon';
import styles from './Section.module.css';

// Collapsible block with a heading, a count and an optional header action.
// Controlled — the open state is the caller's — and the content is unmounted
// while collapsed, so a collapsed section costs nothing.
export const Section = ({
  title,
  open,
  onOpenChange,
  count,
  countPalette = 'gray',
  action,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count?: number | string | null;
  countPalette?: BadgePalette;
  action?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) => {
  const bodyId = useId();
  return (
    <div className={cx(styles.root, className)}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.trigger}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => onOpenChange(!open)}
        >
          <Icon
            icon="chevron_forward"
            size={18}
            className={cx(styles.chevron, open && styles.chevronOpen)}
          />
          <span className={styles.title}>{title}</span>
          <CountBadge count={count} palette={countPalette} />
        </button>
        {action}
      </div>
      {open && (
        <div
          id={bodyId}
          className={cx(styles.body, bodyClassName)}
        >
          {children}
        </div>
      )}
    </div>
  );
};
