import { useSetAtom } from 'jotai';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { IconButton } from './Button';
import { cx } from './cx';
import styles from './Dialog.module.css';
import { overlayOpenCountAtom } from './overlayAtoms';

/*
 * Modal built on the native <dialog> element.
 *
 * showModal() gives us the focus trap, Escape-to-close, inert background and
 * top-layer stacking for free — which is most of what a hand-rolled modal
 * gets wrong, and the reason this is ~60 lines instead of ~300. Being in the
 * top layer also means no z-index: it paints above the ribbon, the popovers
 * and the 1000-level fixed bars regardless of the ladder in tokens.css.
 *
 * `data-scope="dialog"` is required, not decorative — see Popover.tsx.
 */

export const Dialog = ({
  open,
  onOpenChange,
  title,
  footer,
  children,
  bare,
  flushBody,
  closeLabel = 'Lukk',
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit together with `bare` for a chromeless dialog (the lightbox). */
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
  bare?: boolean;
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
      className={cx(styles.dialog, bare && styles.bare, className)}
      // Escape and the browser's own dismissal both land here; the element
      // has already decided to close, so mirror that into React state rather
      // than trying to prevent it.
      onCancel={(e) => {
        e.preventDefault();
        onOpenChange(false);
      }}
      onClose={() => onOpenChange(false)}
      // Backdrop press: <dialog>'s own box fills the viewport when modal, so
      // a pointer outside the inner panel's rect is a click on the backdrop.
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
      {bare ? (
        children
      ) : (
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
      )}
    </dialog>
  );
};
