import { Alert, Tooltip } from '@mantine/core';
import { useAtom } from 'jotai';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { evidenceFileUrl, type EvidenceRecord } from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import { useHasFeature } from '../auth/features';
import { ControlButton } from '../ui/ControlButton';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import { draftGroundAtom } from './draftGround';
import { useEvidenceDownload } from './download';
import styles from './EvidenceGallery.module.css';
import type { OverlayTile } from './evidenceOverlay';
import { EvidenceThumb } from './EvidenceThumb';
import { groupEvidence, type EvidenceGroup } from './groups';
import { downloadLabel, evidenceLabel, KIND_ICON, renderNote } from './labels';
import { moved } from './order';
import { mayRetry, type RenderState } from './queue';
import {
  coverOf,
  evidenceBandTop,
  evidenceBbox,
  evidenceRenderable,
  isReadable,
  isVideoEvidence,
  rendersOnServer,
} from './spec';
import type { SpotEvidence } from './useSpotEvidence';

type Drag = {
  key: string;
  from: number;
  to: number;
  slots: number[];
};

const EvidenceItem = ({
  record,
  count,
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
  count: number;
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
  const mayRender = useHasFeature('render');
  const mayRedo =
    evidenceRenderable(record) && (mayRender || !rendersOnServer(record.kind));

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
              {count > 1 && ` · ${t('evidence.tileCount', { count })}`}
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

      {mayRetry(state) && mayRedo && (
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
  const { items } = evidence;
  const file = useEvidenceDownload(spot);
  const [ground, setGround] = useAtom(draftGroundAtom);
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const groups = useMemo(() => groupEvidence(items ?? []), [items]);

  useEffect(() => {
    if (!ground || items === null) return;
    const group = groups.find((g) => g.key === ground.id);
    if (!group || !group.rows.some((rec) => rec.file)) setGround(null);
  }, [ground, groups, items, setGround]);

  useEffect(() => () => setGround(null), [setGround]);

  const groupStateOf = (group: EvidenceGroup): RenderState | undefined => {
    const states = group.rows.map((rec) => evidence.stateOf(rec));
    if (states.some((s) => s === 'failed')) return 'failed';
    if (states.some((s) => s === 'empty')) return 'empty';
    if (states.some((s) => s === 'running')) return 'running';
    if (states.some((s) => s === 'queued')) return 'queued';
    return undefined;
  };

  const startDrag =
    (key: string, from: number) => (event: ReactPointerEvent<HTMLElement>) => {
      const list = listRef.current;
      if (!list || event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({
        key,
        from,
        to: from,
        slots: [...list.children].map((row) => {
          const rect = row.getBoundingClientRect();
          return rect.top + rect.height / 2;
        }),
      });
    };

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
    if (drag) evidence.reorderGroup(drag.key, drag.to);
    setDrag(null);
  };

  const nudge =
    (key: string, index: number, total: number) =>
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const delta =
        event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      if (delta === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const to = index + delta;
      if (to < 0 || to >= total) return;
      evidence.reorderGroup(key, to);
    };

  const pick = (group: EvidenceGroup) => {
    if (ground?.id === group.key) {
      setGround(null);
      return;
    }
    const cover = group.cover;
    if (isVideoEvidence(cover)) {
      const extent = evidenceBbox(cover);
      const url = evidenceFileUrl(cover);
      if (!url || !extent) return;
      setGround({
        id: group.key,
        tiles: [],
        loop: { url, extent, bandTop: evidenceBandTop(cover) },
      });
      return;
    }
    const tiles: OverlayTile[] = [];
    for (const rec of group.rows) {
      const extent = evidenceBbox(rec);
      const url = evidenceFileUrl(rec);
      if (extent && url) tiles.push({ url, extent });
    }
    if (tiles.length > 0) setGround({ id: group.key, tiles });
  };

  const shown = drag ? moved(groups, drag.from, drag.to) : groups;
  const coverId = coverOf(items ?? [])?.id;

  return (
    <div className={styles.gallery}>
      <div className={styles.head}>
        <Icon icon="photo_library" size={14} />
        <span>{t('evidence.label')}</span>
      </div>
      {items === null ? (
        !evidence.failed && (
          <p className={styles.hint}>{t('evidence.loading')}</p>
        )
      ) : shown.length === 0 ? (
        <p className={styles.hint}>{t('evidence.noneOwn')}</p>
      ) : (
        <>
          <p className={styles.hint}>{t('evidence.order.hint')}</p>
          <ul className={styles.list} ref={listRef}>
            {shown.map((group, index) => (
              <EvidenceItem
                key={group.key}
                record={group.cover}
                count={group.rows.length}
                state={groupStateOf(group)}
                cover={group.rows.some((rec) => rec.id === coverId)}
                onMap={ground?.id === group.key}
                downloading={file.busyId === group.cover.id}
                downloadFailed={file.failedId === group.cover.id}
                lifted={drag?.key === group.key}
                onPick={() => pick(group)}
                onDownload={() => file.download(group)}
                onRetry={() =>
                  group.rows
                    .filter((rec) => mayRetry(evidence.stateOf(rec)))
                    .forEach((rec) => evidence.retry(rec))
                }
                onRemove={() =>
                  group.rows.forEach((rec) => evidence.remove(rec.id))
                }
                onDragStart={startDrag(group.key, index)}
                onDragMove={onDragMove}
                onDragEnd={endDrag}
                onNudge={nudge(group.key, index, shown.length)}
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
