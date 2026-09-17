import { useSetAtom } from 'jotai';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { IconButton } from './Button';
import { cx } from './cx';
import styles from './Dialog.module.css';
import { overlayOpenCountAtom } from './overlayAtoms';

// Native <dialog>: showModal() brings the focus trap, Escape, the inert
// background and top-layer stacking, so no z-index applies here.
// `data-scope="dialog"` is required, not decorative — see Popover.tsx.

export const Dialog = ({
  open,
  onOpenChange,
  title,
  footer,
  children,
  flushBody,
  closeLabel = 'Lukk',
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit for a dialog with no header bar. */
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
  flushBody?: boolean;
  closeLabel?: string;
  className?: string;
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  const bumpOverlayCount = useSetAtom(overlayOpenCountAtom);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
      bumpOverlayCount((n) => n + 1);
      return () => bumpOverlayCount((n) => n - 1);
    }
    if (el.open) el.close();
  }, [open, bumpOverlayCount]);

  return (
    <dialog
      ref={ref}
      data-scope="dialog"
      className={cx(styles.dialog, className)}
      // The browser's own dismissal closes the element behind React's back.
      onCancel={(e) => {
        e.preventDefault();
        onOpenChange(false);
      }}
      onClose={() => onOpenChange(false)}
      // The box fills the viewport, so outside the panel's rect is backdrop.
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        const inside =
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom;
        if (!inside) onOpenChange(false);
      }}
    >
      <div className={styles.panel}>
        {title != null && (
          <div className={styles.header}>
            <h2 className={styles.title}>{title}</h2>
            <IconButton
              icon="close"
              aria-label={closeLabel}
              palette="gray"
              onClick={() => onOpenChange(false)}
            />
          </div>
        )}
        <div className={cx(styles.body, flushBody && styles.bodyFlush)}>
          {children}
        </div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </dialog>
  );
};
