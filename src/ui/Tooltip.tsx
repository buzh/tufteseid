import type { ReactNode } from 'react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import styles from './Tooltip.module.css';

/*
 * Hover/focus label. Not an overlay in the Popover sense — it never takes
 * focus and never traps keys, so it does not touch overlayOpenCountAtom and
 * carries no data-scope.
 *
 * Below the anchor by default because almost every tooltip in this app hangs
 * off a control in the top ribbon, where there is nothing above to point at.
 */

const MARGIN = 8;
const GAP = 6;

export const Tooltip = ({
  label,
  children,
  placement = 'bottom',
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  placement?: 'top' | 'bottom';
  className?: string;
}) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    const rect = anchor.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const top = placement === 'top' ? rect.top - th - GAP : rect.bottom + GAP;
    const left = Math.min(
      Math.max(MARGIN, rect.left + rect.width / 2 - tw / 2),
      Math.max(MARGIN, window.innerWidth - tw - MARGIN),
    );
    setPos({ top, left });
  }, [open, placement]);

  return (
    <>
      <span
        ref={anchorRef}
        className={cx(styles.anchor, className)}
        aria-describedby={open ? id : undefined}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocusCapture={() => setOpen(true)}
        onBlurCapture={() => setOpen(false)}
        // A tooltip that survives the click it describes is just noise.
        onPointerDown={() => setOpen(false)}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className={cx(styles.tip, !pos && styles.measuring)}
            style={pos ?? undefined}
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
};
