import { useSetAtom } from 'jotai';
import type { ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { overlayOpenCountAtom } from './overlayAtoms';
import styles from './Popover.module.css';

// Anchored overlay, portalled to <body>. No placement solver: below the
// anchor, clamped into the viewport, flipping above only when it does not fit.
//
// Load-bearing: `data-scope="popover"` on the content, which the keyboard
// layers walk up from event.target for — without it the map cycling keys fire
// while a pulldown has focus — and focus moving into the content on open,
// since that walk only reaches the attribute from inside.

const MARGIN = 8;
const GAP = 6;
const MIN_HEIGHT = 80;

type Align = 'start' | 'center' | 'end';

export const Popover = ({
  open,
  onOpenChange,
  trigger,
  children,
  align = 'start',
  width,
  minWidth,
  padded = true,
  label,
  className,
  contentClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rendered inline inside a flex wrapper that the panel anchors to. */
  trigger: ReactNode;
  children: ReactNode;
  align?: Align;
  width?: number;
  minWidth?: number;
  /** Set false when the content brings its own padding (e.g. a list). */
  padded?: boolean;
  /** Accessible name for the panel. */
  label?: string;
  className?: string;
  contentClassName?: string;
}) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const bumpOverlayCount = useSetAtom(overlayOpenCountAtom);

  // Capture, so nested scrollers count.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const anchor = anchorRef.current;
      const content = contentRef.current;
      if (!anchor || !content) return;
      const rect = anchor.getBoundingClientRect();
      const cw = content.offsetWidth;
      // `scrollHeight`, not `offsetHeight`: with a maxHeight on the panel the
      // first cramped answer would latch. Plus the 1 px border each side.
      const wanted = content.scrollHeight + 2;
      const below = window.innerHeight - rect.bottom - GAP - MARGIN;
      const above = rect.top - GAP - MARGIN;
      const flip = wanted > below && above > below;
      // Floored: an anchor against an edge would otherwise clamp to nothing.
      const maxHeight = Math.max(flip ? above : below, MIN_HEIGHT);
      const top = flip
        ? Math.max(MARGIN, rect.top - GAP - Math.min(wanted, maxHeight))
        : rect.bottom + GAP;
      const raw =
        align === 'end'
          ? rect.right - cw
          : align === 'center'
            ? rect.left + rect.width / 2 - cw / 2
            : rect.left;
      const left = Math.min(
        Math.max(MARGIN, raw),
        Math.max(MARGIN, window.innerWidth - cw - MARGIN),
      );
      setPos((cur) =>
        cur &&
        cur.top === top &&
        cur.left === left &&
        cur.maxHeight === maxHeight
          ? cur
          : { top, left, maxHeight },
      );
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    bumpOverlayCount((n) => n + 1);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    contentRef.current?.focus({ preventScroll: true });
    return () => {
      bumpOverlayCount((n) => n - 1);
      // Only reclaim focus if it is still inside us.
      if (
        previouslyFocused?.isConnected &&
        contentRef.current?.contains(document.activeElement)
      ) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open, bumpOverlayCount]);

  // pointerdown, not click, so a drag starting on the map closes the panel
  // before the map begins panning.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (contentRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return; // trigger toggles itself
      onOpenChange(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, onOpenChange]);

  return (
    <>
      <span ref={anchorRef} className={cx(styles.anchor, className)}>
        {trigger}
      </span>
      {open &&
        createPortal(
          <div
            ref={contentRef}
            role="dialog"
            aria-label={label}
            data-scope="popover"
            tabIndex={-1}
            className={cx(
              styles.content,
              !pos && styles.measuring,
              padded && styles.padded,
              contentClassName,
            )}
            style={{
              width,
              minWidth,
              ...(pos
                ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight }
                : null),
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                onOpenChange(false);
              }
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
};
