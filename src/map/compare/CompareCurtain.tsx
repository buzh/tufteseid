// The curtain's draggable edge: the grab target and the visible seam only —
// `compareLayers.ts` does the clip. The two agree because the shell and the map
// viewport are the same rectangle.
//
// Mounted only while the curtain is the view, by `MapComponent`, so there is no
// mode check in here: the clip handlers are attached with the B stack and a
// seam over a map that is not clipped would be a line drawn across one ground.

import { useAtom } from 'jotai';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { compareSplitAtom } from './atoms';
import styles from './CompareCurtain.module.css';
import { setCurtainSplit } from './compareLayers';

// Far enough from either edge that the handle can't be pushed out of reach.
const MIN_SPLIT = 0.05;
const MAX_SPLIT = 0.95;
const KEY_STEP = 0.02;

const clamp = (f: number) => Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, f));

export const CompareCurtain = () => {
  const { t } = useTranslation();
  const [split, setSplit] = useAtom(compareSplitAtom);
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // React draws the seam from the atom; the clip reads a module-level copy.
  // Both written in the handler, in this order: OL renders on the next
  // animation frame and React commits before the same frame's paint, so the
  // line and the edge of the imagery move together. Through an effect the
  // render would be scheduled only after the browser had painted the handle,
  // and a drag would show a strip of A to the right of the seam the whole way.
  const applySplit = (fraction: number) => {
    const next = clamp(fraction);
    setCurtainSplit(next);
    setSplit(next);
  };

  const moveTo = (clientX: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    applySplit((clientX - rect.left) / rect.width);
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('viewControls.divider')}
        aria-valuenow={Math.round(split * 100)}
        aria-valuemin={Math.round(MIN_SPLIT * 100)}
        aria-valuemax={Math.round(MAX_SPLIT * 100)}
        tabIndex={0}
        className={styles.handle}
        style={{ left: `${split * 100}%` }}
        onPointerDown={(e) => {
          // The primary button only. A right-click's `pointerup` is swallowed
          // by the context menu, so a drag started on one would never end and
          // the seam would follow the cursor across the map.
          if (!e.isPrimary || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => dragging && moveTo(e.clientX)}
        onPointerUp={(e) => {
          // A pointer that was refused above never took the capture.
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          // Stop the map's own arrow-key panning.
          e.preventDefault();
          e.stopPropagation();
          applySplit(split + (e.key === 'ArrowLeft' ? -1 : 1) * KEY_STEP);
        }}
      >
        <span className={styles.line} />
        <span className={styles.grip} />
      </div>
    </div>
  );
};
