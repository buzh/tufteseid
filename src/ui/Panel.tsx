// The box the floating surfaces on the map are made of: a header saying what it
// is, a fold and a close in the top right corner, the content, and an optional
// row of verbs along the bottom.
//
// Three boxes wear it — the terrain analysis at the top left, the spot box at
// the top right, and the heritage card pinned to the ground it is about — and
// they had three headers between them, with three ideas of where the fold was
// and whether there was a way out at all. The chrome is the same in all three
// because it is the same gesture in all three: get this out of my way, or put
// it down.
//
// Positioning is not in here. Where a box sits is a property of the box, not of
// the chrome, so the caller passes a class and this one supplies the surface —
// border, radius, opaque ground, shadow, and a body that takes the slack and
// scrolls in it.
//
// `unsaved` is the one thing the content has to tell the box: with work in it
// that closing would lose, the close asks twice (`useConfirm`) rather than
// raising a dialog to ask once. What counts as unsaved is the content's
// business — for a draft it is what the reader typed or drew.

import { ActionIcon, Tooltip } from '@mantine/core';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from './cx';
import { Icon, type MaterialSymbol } from './Icon';
import styles from './Panel.module.css';
import { useConfirm } from './useConfirm';

export type PanelProps = {
  /** Beside the title, for a box whose subject has a glyph. */
  icon?: MaterialSymbol;
  /** What the box is. Also its accessible name. */
  title: string;
  /**
   * One dimmed line under the title. Survives the fold, so it is what a shut
   * box still says — a fetch, a resolution, a count.
   */
  status?: ReactNode;
  /** Off for a box that is nothing without its content. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Absent: the box has no way out of its own, and something else takes it
   *  down. */
  onClose?: () => void;
  /** There is work in here that closing would throw away, so the close asks
   *  twice. */
  unsaved?: boolean;
  /** The row along the bottom. Folded away with the body. */
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
      {/* The corner buttons are buttons, and the title is not one. A header
          that folds on click as well would be two controls over one state,
          which is a second thing for a screen reader to announce and a stray
          click away from folding the box while reaching for its text. */}
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
              {/* One glyph both ways round, because a second name is a second
                  thing that can fail to be in the `MaterialSymbol` union. */}
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

      {/* Rendered rather than hidden: a folded box is a header, and the content
          of these three is a grid of sliders, a form and a register's answer —
          none of them cheap to keep laid out behind a `display: none`. */}
      {open && <div className={styles.body}>{children}</div>}
      {open && footer && <div className={styles.footer}>{footer}</div>}
    </section>
  );
};
