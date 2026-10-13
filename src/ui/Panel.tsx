import { ActionIcon, Tooltip } from '@mantine/core';
import {
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from './cx';
import { Icon, type MaterialSymbol } from './Icon';
import styles from './Panel.module.css';
import { useConfirm } from './useConfirm';

type PointerHandlers = Pick<
  ComponentPropsWithoutRef<'div'>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'
>;

export type PanelProps = {
  icon?: MaterialSymbol;
  title: string;
  status?: ReactNode;
  handle?: PointerHandlers;
  actions?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  onClose?: () => void;
  unsaved?: boolean;
  footer?: ReactNode;
  className?: string;
  ref?: Ref<HTMLElement>;
  children: ReactNode;
} & Omit<
  ComponentPropsWithoutRef<'section'>,
  'title' | 'onClose' | 'className' | 'children'
>;

export const Panel = ({
  icon,
  title,
  status,
  handle,
  actions,
  collapsible = true,
  defaultOpen = true,
  onClose,
  unsaved = false,
  footer,
  className,
  ref,
  children,
  ...rest
}: PanelProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const close = useConfirm(() => onClose?.(), unsaved);

  const foldLabel = t(open ? 'panel.collapse' : 'panel.expand');
  const closeLabel = t(close.armed ? 'panel.closeUnsaved' : 'panel.close');

  return (
    <section
      {...rest}
      ref={ref}
      className={cx(styles.panel, className)}
      aria-label={title}
    >
      <div
        {...handle}
        className={cx(
          styles.header,
          open && styles.headerOpen,
          handle && styles.headerHandle,
        )}
      >
        {icon && <Icon icon={icon} size={16} className={styles.headerIcon} />}
        <span className={styles.headerText}>
          <span className={styles.title}>{title}</span>
          {status != null && <span className={styles.status}>{status}</span>}
        </span>

        {actions}

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
              variant="filled"
              color={close.armed ? 'red' : 'papaya'}
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
