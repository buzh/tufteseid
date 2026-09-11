import type { ReactNode } from 'react';
import { useId } from 'react';
import { type BadgePalette, CountBadge } from './Badge';
import { cx } from './cx';
import { Icon } from './Icon';
import styles from './Section.module.css';

/*
 * Collapsible block with a heading, a count and an optional action on the
 * header row.
 *
 * Controlled: the open state is the caller's, not this component's. The
 * lokalitet dock that once kept its sections in a shared atom is gone, and
 * the callers left — the search panels and the help page — each have their
 * own idea of what "open" means and when it survives a remount.
 *
 * Content is unmounted while collapsed. That is a change from the kvib
 * Collapsible, and the point of it: the Bilder gallery fetches short-lived
 * file tokens for its thumbnails, and a collapsed section should not.
 */
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
