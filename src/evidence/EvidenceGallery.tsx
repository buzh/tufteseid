// The spot's kept pictures, in the card: the one place their order is set and
// the one place a picture is laid back on the map to trace over.

import { Alert, Tooltip } from '@mantine/core';
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
import { ControlButton } from '../ui/ControlButton';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import { draftGroundAtom } from './draftGround';
import { useEvidenceDownload } from './download';
import styles from './EvidenceGallery.module.css';
import { EvidenceThumb } from './EvidenceThumb';
import { downloadLabel, evidenceLabel, KIND_ICON, renderNote } from './labels';
import { moved } from './order';
import { mayRetry, type RenderState } from './queue';
import {
  coverOf,
  evidenceBandTop,
  evidenceBbox,
  isReadable,
  isVideoEvidence,
} from './spec';
import type { SpotEvidence } from './useSpotEvidence';

type Drag = {
  id: string;
  from: number;
  /** The slot the row is being shown in, which is also where it would land. */
  to: number;
  /** Where the middle of every slot is, measured at the press. The rows are
   *  one height, so previewing a move does not move the slots. */
  slots: number[];
};

const EvidenceItem = ({
  record,
  state,
  cover,
  onMap,
  downloading,
  downloadFailed,
  lifted,
  onPick,
  onDownload,
  onRetry,
  onRemove,
  onDragStart,
  onDragMove,
  onDragEnd,
  onNudge,
}: {
  record: EvidenceRecord;
  state: RenderState | undefined;
  cover: boolean;
  onMap: boolean;
  downloading: boolean;
  downloadFailed: boolean;
  lifted: boolean;
  onPick: () => void;
  onDownload: () => void;
  onRetry: () => void;
  onRemove: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onDragMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onDragEnd: (event: ReactPointerEvent<HTMLElement>) => void;
  onNudge: (event: ReactKeyboardEvent<HTMLElement>) => void;
}) => {
  const { t } = useTranslation();
  const title = evidenceLabel(record);
  const file = evidenceFileUrl(record);
  const note = renderNote(record, state);

  return (
    <li className={cx(styles.row, lifted && styles.lifted)}>
      <Tooltip label={t('evidence.order.move')}>
        <button
          type="button"
          className={styles.handle}
          aria-label={t('evidence.order.move')}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onKeyDown={onNudge}
        >
          <Icon icon="drag_indicator" size={16} />
        </button>
      </Tooltip>

      <Tooltip
        label={t(onMap ? 'evidence.order.groundOff' : 'evidence.order.ground')}
      >
        <button
          type="button"
          className={cx(styles.pick, onMap && styles.picked)}
          aria-pressed={onMap}
          disabled={!isReadable(record)}
          onClick={onPick}
        >
          {record.file ? (
            <EvidenceThumb record={record} className={styles.thumb} />
          ) : (
            <span className={cx(styles.thumb, styles.pending)}>
              <Icon icon="hourglass_top" size={16} />
            </span>
          )}
          <span className={styles.text}>
            <span className={styles.title}>
              <Icon icon={KIND_ICON[record.kind]} size={12} /> {title}
            </span>
            {note && <span className={styles.note}>{note}</span>}
          </span>
        </button>
      </Tooltip>

      {cover && (
        <Tooltip label={t('evidence.order.cover')}>
          <span className={styles.cover}>
            <Icon icon="star" size={14} filled />
          </span>
        </Tooltip>
      )}

      {file && (
        <>
          <Tooltip label={t('evidence.open')}>
            <ControlButton
              icon="open_in_new"
              aria-label={t('evidence.open')}
              onClick={() => window.open(file, '_blank', 'noopener,noreferrer')}
            />
          </Tooltip>
          <Tooltip
            label={downloadLabel({ downloading, failed: downloadFailed })}
          >
            <ControlButton
              icon={downloading ? 'hourglass_top' : 'download'}
              aria-label={t('evidence.download')}
              disabled={downloading}
              onClick={onDownload}
            />
          </Tooltip>
        </>
      )}

      {mayRetry(state) && (
        <Tooltip label={t('evidence.retry')}>
          <ControlButton
            icon="refresh"
            aria-label={t('evidence.retry')}
            onClick={onRetry}
          />
        </Tooltip>
      )}

      <Tooltip label={t('evidence.remove')}>
        <ControlButton
          icon="delete"
          aria-label={t('evidence.remove')}
          onClick={onRemove}
        />
      </Tooltip>
    </li>
  );
};

export const EvidenceGallery = ({
  spot,
  evidence,
}: {
  spot: SpotRecord;
  evidence: SpotEvidence;
}) => {
  const { t } = useTranslation();
  const { items, reorder } = evidence;
  const file = useEvidenceDownload(spot);
  const [ground, setGround] = useAtom(draftGroundAtom);
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // A row the author deleted, or whose render the queue is redoing, must not
  // leave its picture on the map.
  useEffect(() => {
    if (!ground || items === null) return;
    if (!items.some((rec) => rec.id === ground.id && rec.file)) setGround(null);
  }, [ground, items, setGround]);

  // The list goes when the spot is closed or the reading opens, and the picture
  // is the list's: nothing else is left to take it off the map.
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

  // The handle answers the arrows too, for a reader with no pointer. Stopped
  // before the bounds check, or OpenLayers' keyboard pan answers the press that
  // runs off the end.
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
    const loop = isVideoEvidence(rec)
      ? { bandTop: evidenceBandTop(rec) }
      : undefined;
    setGround(ground?.id === rec.id ? null : { id: rec.id, url, extent, loop });
  };

  const rows = items ? (drag ? moved(items, drag.from, drag.to) : items) : [];
  const cover = coverOf(rows)?.id;

  return (
    <div className={styles.gallery}>
      <div className={styles.head}>
        <Icon icon="photo_library" size={14} />
        <span>{t('evidence.label')}</span>
      </div>
      {/* The heading stands in all three states so the card does not jump as
          the list lands. An empty list says so here rather than only in
          `EvidenceReader`, which is the surface for the reader who cannot do
          anything about it. A list that never landed is neither loading nor
          empty, and the alert below is the whole of what can be said. */}
      {items === null ? (
        !evidence.failed && (
          <p className={styles.hint}>{t('evidence.loading')}</p>
        )
      ) : rows.length === 0 ? (
        <p className={styles.hint}>{t('evidence.noneOwn')}</p>
      ) : (
        <>
          <p className={styles.hint}>{t('evidence.order.hint')}</p>
          <ul className={styles.list} ref={listRef}>
            {rows.map((rec, index) => (
              <EvidenceItem
                key={rec.id}
                record={rec}
                state={evidence.stateOf(rec)}
                cover={rec.id === cover}
                onMap={ground?.id === rec.id}
                downloading={file.busyId === rec.id}
                downloadFailed={file.failedId === rec.id}
                lifted={drag?.id === rec.id}
                onPick={() => pick(rec)}
                onDownload={() => file.download(rec)}
                onRetry={() => evidence.retry(rec)}
                onRemove={() => evidence.remove(rec.id)}
                onDragStart={startDrag(rec.id, index)}
                onDragMove={onDragMove}
                onDragEnd={endDrag}
                onNudge={nudge(rec.id, index, rows.length)}
              />
            ))}
          </ul>
        </>
      )}

      {evidence.failed && (
        <Alert color="red" mt="xs" p="xs">
          {t('evidence.failed')}
        </Alert>
      )}
    </div>
  );
};
