import { useSetAtom } from 'jotai';
import type { ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { overlayOpenCountAtom } from './overlayAtoms';
import styles from './Popover.module.css';

/*
 * Anchored overlay, portalled to <body>.
 *
 * Deliberately simple: below the anchor, clamped into the viewport, tall as
 * the remaining space allows — no placement solver. The one exception is a
 * **flip**, and it is not a nicety: the bilder rail sits on the *bottom* edge
 * of the window (BilderCarousel), so a confirm dropping down from a button
 * there gets a few dozen pixels of room and becomes a scrolling sliver half
 * off the screen. When the panel does not fit below and there is more room
 * above, it opens upwards instead. Everything anchored to the top edge still
 * drops down, because there is always more room below it.
 *
 * Two things here are load-bearing rather than cosmetic:
 *
 *  - `data-scope="popover"` on the content. The keyboard layers walk up from
 *    event.target looking for it (src/localities/useWorkspaceKeys.ts), so
 *    without it the map cycling keys fire while a pulldown has focus.
 *  - focus moves into the content on open and back to the anchor on close.
 *    The data-scope walk only reaches the attribute if the event originates
 *    inside; a panel nobody focuses leaves event.target === document.body.
 *
 * overlayOpenCountAtom is the belt to that braces — see overlayAtoms.ts.
 */

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

  // Position: measured after the content is in the DOM, then kept in step
  // with scroll (capture, so nested scrollers count) and resize.
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
      // `scrollHeight` rather than `offsetHeight`: once a maxHeight is on the
      // panel the measured box is the clamped one, and re-measuring it would
      // latch the first cramped answer for the rest of the session. Plus the
      // 1 px border on each side, which scrollHeight leaves out.
      const wanted = content.scrollHeight + 2;
      const below = window.innerHeight - rect.bottom - GAP - MARGIN;
      const above = rect.top - GAP - MARGIN;
      const flip = wanted > below && above > below;
      // Floored: an anchor pressed right up against an edge would otherwise
      // clamp its panel to nothing, and a zero-height dialog is worse than one
      // that overhangs.
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

  // Count this overlay while it is open, and restore focus on the way out.
  useEffect(() => {
    if (!open) return;
    bumpOverlayCount((n) => n + 1);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    contentRef.current?.focus({ preventScroll: true });
    return () => {
      bumpOverlayCount((n) => n - 1);
      // Only reclaim focus if it is still inside us; otherwise the user has
      // already moved on and yanking it back would be the rude thing.
      if (
        previouslyFocused?.isConnected &&
        contentRef.current?.contains(document.activeElement)
      ) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open, bumpOverlayCount]);

  // Dismiss on outside press. pointerdown rather than click so a drag that
  // starts on the map closes the panel before the map begins panning.
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
