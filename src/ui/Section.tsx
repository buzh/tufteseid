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
 * Controlled, unlike the workspace's own version, which reached into
 * openSectionsAtom itself. The dock needs the same block for sections whose
 * open state is not in that atom, so the binding moves out to the call site.
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
  scroll,
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
  scroll?: boolean;
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
          className={cx(styles.body, scroll && styles.scroll, bodyClassName)}
        >
          {children}
        </div>
      )}
    </div>
  );
};
