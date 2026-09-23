// The grab target and the visible seam only; `compareLayers.ts` does the clip,
// and the two agree because this shell and the map viewport are the same
// rectangle.

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

  // Both writes stay in the handler, not an effect: React commits before the
  // next animation frame, so seam and imagery move together. From an effect the
  // clip lags a frame behind the drag.
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
          // Primary button only: the context menu swallows a right-click's
          // `pointerup`, so that drag would never end.
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
