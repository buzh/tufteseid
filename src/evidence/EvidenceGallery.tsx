// The spot's kept pictures, one list. Asking for another one is the camera in
// `SpotCard`, not here. This list is also where the order is set and where a
// picture is laid back on the map to trace over, so there is no second list of
// the same rows anywhere.

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
import {
  coverOf,
  downloadLabel,
  evidenceLabel,
  evidenceResolution,
  isVideoEvidence,
  KIND_ICON,
  laysOnGround,
} from './labels';
import { moved } from './order';
import { mayRetry, type RenderState } from './queue';
import { evidenceBbox } from './spec';
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

const Thumb = ({ record }: { record: EvidenceRecord }) => {
  const video = isVideoEvidence(record);
  // PocketBase makes no thumbnail for a video, so a loop is its own handle.
  const url = video
    ? evidenceFileUrl(record)
    : evidenceFileUrl(record, '200x200');
  if (!url) {
    return (
      <span className={cx(styles.thumb, styles.pending)}>
        <Icon icon="hourglass_top" size={16} />
      </span>
    );
  }
  return video ? (
    // `#t=0.1` so a frame is painted rather than a black box: with
    // `preload="metadata"` alone, nothing is decoded until play.
    <video
      className={styles.thumb}
      src={`${url}#t=0.1`}
      preload="metadata"
      muted
      playsInline
      aria-hidden="true"
    />
  ) : (
    <img className={styles.thumb} src={url} alt="" />
  );
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
  const metresPerPx = evidenceResolution(record);
  const note =
    state === 'queued' || state === 'running'
      ? t('evidence.rendering')
      : state === 'failed'
        ? t('evidence.renderFailed')
        : state === 'empty'
          ? t('evidence.renderEmpty')
          : metresPerPx != null
            ? t('evidence.resolution', { m: metresPerPx.toFixed(2) })
            : '';

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

      {/* A loop cannot be a sketch ground: the overlay is an `ImageStatic`. */}
      <Tooltip
        label={t(onMap ? 'evidence.order.groundOff' : 'evidence.order.ground')}
      >
        <button
          type="button"
          className={cx(styles.pick, onMap && styles.picked)}
          aria-pressed={onMap}
          disabled={!laysOnGround(record)}
          onClick={onPick}
        >
          <Thumb record={record} />
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
          {/* The thumbnail is a handle for laying the picture on the map; the
              render at the source's own resolution is the artifact. */}
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

  const rows = items ? (drag ? moved(items, drag.from, drag.to) : items) : [];
  const cover = coverOf(rows)?.id;

  return (
    <div className={styles.gallery}>
      {rows.length > 0 && (
        <>
          <div className={styles.head}>
            <Icon icon="photo_library" size={14} />
            <span>{t('evidence.label')}</span>
          </div>
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
