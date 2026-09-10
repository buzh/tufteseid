import type { ReactNode } from 'react';
import { useIsMobileScreen } from '../shared/hooks';
import { cx, IconButton } from '../ui';
import styles from './Dock.module.css';

/**
 * The right-hand column: everything about the thing you are working on, in
 * one place that does not move.
 *
 * This is what replaced the ribbon growing downwards. A tray and a tool row
 * stacked under two bars could reach five hundred pixels of chrome across the
 * top of the map — over the very ground the panels are describing. The same
 * content in a column costs a fixed slice of the width, and the map fits its
 * subject into what is left (see `chromeInsets`).
 *
 * Below the md breakpoint the column has nowhere to go, so it becomes a
 * bottom sheet. `data-chrome` follows, which is the whole reason framing code
 * asks for the edge rather than assuming one.
 *
 * Folding it away hides it rather than unmounting it. Folding is what you do
 * *to see the map* — most often the terrain render the panel inside just
 * produced — and unmounting would take that render off the map with it, along
 * with the DEM behind it and every panel's scroll position. A `display: none`
 * subtree costs nothing to keep and reports no rect, so `chromeInsets` stops
 * counting it on its own.
 */
export const Dock = ({
  head,
  children,
  hidden,
  className,
}: {
  head: ReactNode;
  children: ReactNode;
  hidden?: boolean;
  className?: string;
}) => {
  const isMobile = useIsMobileScreen();
  return (
    <aside
      className={cx(styles.dock, hidden && styles.folded, className)}
      data-chrome={isMobile ? 'bottom' : 'right'}
    >
      <div className={styles.head}>{head}</div>
      <div className={styles.body}>{children}</div>
    </aside>
  );
};

/**
 * A tool that has taken the dock over — the funn being drawn, a running
 * extract, the terrain knobs. Pinned above the section list rather than
 * replacing it: drawing a funn while the funn list is hidden is how you end
 * up drawing the one you already have.
 */
export const DockTool = ({
  title,
  onClose,
  closeLabel,
  children,
}: {
  title: string;
  onClose?: () => void;
  closeLabel?: string;
  children: ReactNode;
}) => (
  <div className={styles.tool}>
    <div className={styles.toolHead}>
      <h3 className={styles.toolTitle}>{title}</h3>
      {onClose && (
        <IconButton
          icon="close"
          size="xs"
          palette="gray"
          aria-label={closeLabel}
          onClick={onClose}
        />
      )}
    </div>
    {children}
  </div>
);
