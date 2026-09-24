import { Tooltip } from '@mantine/core';
import { useAtom } from 'jotai';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { evidenceFileUrl, type EvidenceRecord } from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import { draftGroundAtom } from './draftGround';
import styles from './EvidenceStrip.module.css';
import {
  coverOf,
  evidenceLabel,
  isVideoEvidence,
  KIND_ICON,
  laysOnGround,
} from './labels';
import { moved } from './order';
import { evidenceBbox } from './spec';
import { useSpotEvidence } from './useSpotEvidence';

type Drag = {
  id: string;
  from: number;
  /** The slot the row is being shown in, which is also where it would land. */
  to: number;
  /** Where the middle of every slot is, measured at the press. The rows are
   *  one height, so previewing a move does not move the slots. */
  slots: number[];
};

export const EvidenceStrip = ({ spot }: { spot: SpotRecord }) => {
  const { t } = useTranslation();
  const { items, reorder } = useSpotEvidence(spot);
  const [ground, setGround] = useAtom(draftGroundAtom);
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // A row the author deleted, or whose render the queue is redoing, must not
  // leave its picture on the map.
  useEffect(() => {
    if (!ground || items === null) return;
    if (!items.some((rec) => rec.id === ground.id && rec.file)) setGround(null);
  }, [ground, items, setGround]);

  // The strip unmounts with the draft, and the picture is the draft's: nothing
  // else is left to take it off the map.
  useEffect(() => () => setGround(null), [setGround]);

  const startDrag =
    (id: string, from: number) => (event: ReactPointerEvent<HTMLElement>) => {
      const list = listRef.current;
      if (!list || event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({
        id,
        from,
        to: from,
        slots: [...list.children].map((row) => {
          const rect = row.getBoundingClientRect();
          return rect.top + rect.height / 2;
        }),
      });
    };

  // The slot whose middle is nearest, so the row changes places once the
  // pointer is past halfway and the rule is the same going up as going down.
  const onDragMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return;
    let to = drag.to;
    let nearest = Infinity;
    drag.slots.forEach((middle, slot) => {
      const distance = Math.abs(middle - event.clientY);
      if (distance < nearest) {
        nearest = distance;
        to = slot;
      }
    });
    if (to !== drag.to) setDrag({ ...drag, to });
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag) reorder(drag.id, drag.to);
    setDrag(null);
  };

  // The handle answers the arrows too: a drag is the only other way to reorder,
  // and there is no reaching one without a pointer. Stopped before the bounds
  // check, or OpenLayers' keyboard pan answers the press that runs off the end.
  const nudge =
    (id: string, index: number, total: number) =>
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const delta =
        event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      if (delta === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const to = index + delta;
      if (to < 0 || to >= total) return;
      reorder(id, to);
    };

  const pick = (rec: EvidenceRecord) => {
    const extent = evidenceBbox(rec);
    const url = evidenceFileUrl(rec);
    if (!url || !extent) return;
    setGround(ground?.id === rec.id ? null : { id: rec.id, url, extent });
  };

  if (items === null || items.length === 0) return null;

  const rows = drag ? moved(items, drag.from, drag.to) : items;
  const cover = coverOf(rows)?.id;

  return (
    <div className={styles.strip}>
      <div className={styles.head}>
        <Icon icon="photo_library" size={14} />
        <span>{t('evidence.order.label')}</span>
      </div>
      <p className={styles.hint}>{t('evidence.order.hint')}</p>

      <ul className={styles.list} ref={listRef}>
        {rows.map((rec, index) => {
          const title = evidenceLabel(rec);
          const video = isVideoEvidence(rec);
          const thumb = video
            ? evidenceFileUrl(rec)
            : evidenceFileUrl(rec, '200x200');
          const onMap = ground?.id === rec.id;
          // A loop cannot be a sketch ground: the overlay is an `ImageStatic`.
          const ready = laysOnGround(rec);

          return (
            <li
              key={rec.id}
              className={cx(styles.row, drag?.id === rec.id && styles.lifted)}
            >
              <Tooltip label={t('evidence.order.move')}>
                <button
                  type="button"
                  className={styles.handle}
                  aria-label={t('evidence.order.move')}
                  onPointerDown={startDrag(rec.id, index)}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={nudge(rec.id, index, rows.length)}
                >
                  <Icon icon="drag_indicator" size={16} />
                </button>
              </Tooltip>

              <Tooltip
                label={t(
                  onMap ? 'evidence.order.groundOff' : 'evidence.order.ground',
                )}
              >
                <button
                  type="button"
                  className={cx(styles.pick, onMap && styles.picked)}
                  aria-pressed={onMap}
                  disabled={!ready}
                  onClick={() => pick(rec)}
                >
                  {thumb && video ? (
                    // `#t=0.1` so a frame is painted rather than a black box.
                    <video
                      className={styles.thumb}
                      src={`${thumb}#t=0.1`}
                      preload="metadata"
                      muted
                      playsInline
                      aria-hidden="true"
                    />
                  ) : thumb ? (
                    <img className={styles.thumb} src={thumb} alt="" />
                  ) : (
                    <span className={cx(styles.thumb, styles.pending)}>
                      <Icon icon="hourglass_top" size={16} />
                    </span>
                  )}
                  <span className={styles.title}>
                    <Icon icon={KIND_ICON[rec.kind]} size={12} /> {title}
                  </span>
                </button>
              </Tooltip>

              {rec.id === cover && (
                <Tooltip label={t('evidence.order.cover')}>
                  <span className={styles.cover}>
                    <Icon icon="star" size={14} filled />
                  </span>
                </Tooltip>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
