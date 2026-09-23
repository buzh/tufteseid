import { ActionIcon, Tooltip } from '@mantine/core';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from './cx';
import { Icon, type MaterialSymbol } from './Icon';
import styles from './Panel.module.css';
import { useConfirm } from './useConfirm';

export type PanelProps = {
  icon?: MaterialSymbol;
  title: string;
  /** One dimmed line under the title. Survives the fold. */
  status?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Absent: the box has no close of its own. */
  onClose?: () => void;
  /** Puts the close behind a two-press confirm. */
  unsaved?: boolean;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
};

export const Panel = ({
  icon,
  title,
  status,
  collapsible = true,
  defaultOpen = true,
  onClose,
  unsaved = false,
  footer,
  className,
  children,
}: PanelProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const close = useConfirm(() => onClose?.(), unsaved);

  const foldLabel = t(open ? 'panel.collapse' : 'panel.expand');
  const closeLabel = t(close.armed ? 'panel.closeUnsaved' : 'panel.close');

  return (
    <section className={cx(styles.panel, className)} aria-label={title}>
      <div className={cx(styles.header, open && styles.headerOpen)}>
        {icon && <Icon icon={icon} size={16} className={styles.headerIcon} />}
        <span className={styles.headerText}>
          <span className={styles.title}>{title}</span>
          {status != null && <span className={styles.status}>{status}</span>}
        </span>

        {collapsible && (
          <Tooltip label={foldLabel}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={foldLabel}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <Icon
                icon="keyboard_arrow_down"
                size={18}
                className={cx(styles.chevron, open && styles.chevronOpen)}
              />
            </ActionIcon>
          </Tooltip>
        )}

        {onClose && (
          <Tooltip label={closeLabel}>
            <ActionIcon
              variant={close.armed ? 'filled' : 'subtle'}
              color={close.armed ? 'red' : 'gray'}
              size="sm"
              aria-label={closeLabel}
              onClick={close.press}
            >
              <Icon icon="close" size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </div>

      {open && <div className={styles.body}>{children}</div>}
      {open && footer && <div className={styles.footer}>{footer}</div>}
    </section>
  );
};
