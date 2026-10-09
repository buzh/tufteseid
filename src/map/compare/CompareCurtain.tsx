// The grab target and the visible seam only; `compareLayers.ts` does the clip.
// The two agree because this shell and the map viewport are the same rectangle.

import { useAtom } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  removeUrlParameter,
  setUrlParameter,
} from '../../shared/utils/urlUtils';
import {
  clampSplit,
  compareSplitAtom,
  DEFAULT_SPLIT_PERCENT,
  MAX_SPLIT,
  MIN_SPLIT,
} from './atoms';
import styles from './CompareCurtain.module.css';
import { setCurtainSplit } from './compareLayers';

const KEY_STEP = 0.02;

// A drag writes on every pointer move and `replaceState` is rate-limited, so
// the seam reaches the address bar only once the hand has stopped.
const URL_DEBOUNCE_MS = 400;

export const CompareCurtain = () => {
  const { t } = useTranslation();
  const [split, setSplit] = useAtom(compareSplitAtom);
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // Both writes stay in the handler, not an effect: from an effect the clip
  // lags a frame behind the drag.
  const applySplit = (fraction: number) => {
    const next = clampSplit(fraction);
    setCurtainSplit(next);
    setSplit(next);
  };

  useEffect(() => {
    const percent = Math.round(split * 100);
    const timer = window.setTimeout(() => {
      if (percent === DEFAULT_SPLIT_PERCENT) removeUrlParameter('curtain');
      else setUrlParameter('curtain', percent);
    }, URL_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [split]);

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
