import { useAtom, useAtomValue } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { compareGroundAtom, compareSplitAtom } from './atoms';
import { setCurtainSplit } from './curtainLayers';
import styles from './CompareCurtain.module.css';

// Far enough from either edge that the half being dragged away is still a
// strip of map rather than a rumour, and that the handle can't be pushed
// out of reach.
const MIN_SPLIT = 0.05;
const MAX_SPLIT = 0.95;
const KEY_STEP = 0.02;

const clamp = (f: number) => Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, f));

/**
 * The draggable edge between the two halves.
 *
 * The clip itself is done on the canvas (curtainLayers.ts); this is only the
 * grab target and the visible seam. They agree because the shell and the map
 * viewport are the same rectangle, so a CSS percentage of the shell's width
 * is the same fraction the clip uses.
 *
 * It renders *under* the ribbon and the dock, like everything else that
 * belongs to the map. Dragging the seam under the dock is possible and
 * pointless, which is why the clamp above is generous rather than tight —
 * fencing it off against measured chrome would be a rule to maintain for a
 * gesture nobody makes twice.
 */
export const CompareCurtain = () => {
  const { t } = useTranslation();
  const ground = useAtomValue(compareGroundAtom);
  const [split, setSplit] = useAtom(compareSplitAtom);
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // The atom is what React draws the seam from; the canvas clip reads a
  // module-level copy, because OL calls the render handlers, not us.
  useEffect(() => {
    setCurtainSplit(split);
  }, [split]);

  if (!ground) return null;

  const moveTo = (clientX: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setSplit(clamp((clientX - rect.left) / rect.width));
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('ribbon.compare.divider')}
        aria-valuenow={Math.round(split * 100)}
        aria-valuemin={Math.round(MIN_SPLIT * 100)}
        aria-valuemax={Math.round(MAX_SPLIT * 100)}
        tabIndex={0}
        className={styles.handle}
        style={{ left: `${split * 100}%` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => dragging && moveTo(e.clientX)}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          // Stop the map's own arrow-key panning: the handle is focused, so
          // the intent is unambiguous.
          e.preventDefault();
          e.stopPropagation();
          setSplit((s) => clamp(s + (e.key === 'ArrowLeft' ? -1 : 1) * KEY_STEP));
        }}
      >
        <span className={styles.line} />
        <span className={styles.grip} />
      </div>
    </div>
  );
};
