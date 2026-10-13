

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

const URL_DEBOUNCE_MS = 400;

export const CompareCurtain = () => {
  const { t } = useTranslation();
  const [split, setSplit] = useAtom(compareSplitAtom);
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

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

          if (!e.isPrimary || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => dragging && moveTo(e.clientX)}
        onPointerUp={(e) => {

          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

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
