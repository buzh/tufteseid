import { useSetAtom } from 'jotai';
import type { MouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LocalityFindRecord, LocalityFindStatus } from '../api/localityFinds';
import {
  Badge,
  type BadgePalette,
  Button,
  cx,
  Icon,
  IconButton,
  Input,
  NoteInput,
  Popover,
  Spinner,
} from '../ui';
import { hoveredFunnIdAtom } from './atoms';
import styles from './FunnList.module.css';

const STATUS_ORDER: LocalityFindStatus[] = [
  'mulig',
  'sannsynlig',
  'avkreftet',
  'rapportert',
];

const STATUS_PALETTE: Record<LocalityFindStatus, BadgePalette> = {
  mulig: 'yellow',
  sannsynlig: 'green',
  avkreftet: 'red',
  rapportert: 'blue',
};

/*
 * Every control in here calls stopPropagation on its click. The row itself
 * is clickable (it zooms the map to the funn), and React events bubble
 * through the component tree — so even the portalled popover bodies would
 * otherwise fire the row's handler.
 */

const StatusPicker = ({
  value,
  editable,
  onChange,
}: {
  value: LocalityFindStatus;
  editable: boolean;
  onChange: (v: LocalityFindStatus) => void;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const badge = (
    <Badge palette={STATUS_PALETTE[value]}>
      {t(`localities.funn.status.${value}`)}
    </Badge>
  );

  if (!editable) return badge;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={190}
      label={t('localities.funn.status.heading')}
      trigger={
        <button
          type="button"
          className={styles.statusTrigger}
          title={t('localities.funn.status.pickHint')}
          aria-expanded={open}
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          {badge}
          <Icon icon="keyboard_arrow_down" size={14} />
        </button>
      }
    >
      <p className={styles.menuTitle}>{t('localities.funn.status.heading')}</p>
      <div className={styles.menu}>
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            className={cx(
              styles.menuItem,
              s === value && styles.menuItemActive,
            )}
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              setOpen(false);
              if (s !== value) onChange(s);
            }}
          >
            {/* The same badge the row shows, so picking is recognition
                rather than reading a word list. */}
            <Badge palette={STATUS_PALETTE[s]}>
              {t(`localities.funn.status.${s}`)}
            </Badge>
          </button>
        ))}
      </div>
    </Popover>
  );
};

/*
 * Delete confirms in place rather than nesting a second popover.
 *
 * It confirms at all because the *card* is the reversible half: since §5.6
 * the deletion is deferred until `Lagre`, and the row keeps offering `Angre
 * sletting` for the rest of the session. That is the safety net, and this
 * question is the one that stops a mis-click putting a funn in it.
 */
const RowMenu = ({
  onEditText,
  onEditGeometry,
  onDelete,
}: {
  onEditText: () => void;
  onEditGeometry: () => void;
  onDelete: () => void;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const close = () => {
    setOpen(false);
    setConfirming(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirming(false);
      }}
      align="end"
      width={230}
      label={t('localities.funn.actions.menu')}
      trigger={
        <IconButton
          icon="more_vert"
          size="xs"
          palette="gray"
          aria-label={t('localities.funn.actions.menu')}
          aria-expanded={open}
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        />
      }
    >
      <div onClick={(e: MouseEvent) => e.stopPropagation()}>
        {confirming ? (
          <>
            <p className={styles.menuTitle}>
              {t('localities.funn.confirmDeleteShort')}
            </p>
            <div className={styles.confirmActions}>
              <Button
                size="xs"
                palette="gray"
                onClick={() => setConfirming(false)}
              >
                {t('localities.funn.draft.cancel')}
              </Button>
              <Button
                size="xs"
                variant="primary"
                palette="red"
                onClick={() => {
                  close();
                  onDelete();
                }}
              >
                {t('localities.funn.actions.delete')}
              </Button>
            </div>
          </>
        ) : (
          <div className={styles.menu}>
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                close();
                onEditText();
              }}
            >
              <Icon icon="edit" size={16} />
              {t('localities.funn.actions.edit')}
            </button>
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                close();
                onEditGeometry();
              }}
            >
              <Icon icon="draw" size={16} />
              {t('localities.funn.actions.editGeometry')}
            </button>
            <button
              type="button"
              className={cx(styles.menuItem, styles.menuItemDanger)}
              onClick={() => setConfirming(true)}
            >
              <Icon icon="delete" size={16} />
              {t('localities.funn.actions.delete')}
            </button>
          </div>
        )}
      </div>
    </Popover>
  );
};

const FunnRow = ({
  funn,
  editable,
  selected,
  deleted,
  onSelect,
  onStatus,
  onSaveMeta,
  onEditGeometry,
  onDelete,
  onRestore,
}: {
  funn: LocalityFindRecord;
  editable: boolean;
  selected: boolean;
  /** Tombstoned by this edit session — greyed, and one press from coming
   *  back (§5.6, consequence 2). */
  deleted: boolean;
  onSelect: (f: LocalityFindRecord) => void;
  onStatus: (f: LocalityFindRecord, s: LocalityFindStatus) => void;
  onSaveMeta: (f: LocalityFindRecord, title: string, note: string) => void;
  onEditGeometry: (f: LocalityFindRecord) => void;
  onDelete: (f: LocalityFindRecord) => void;
  onRestore: (id: string) => void;
}) => {
  const { t } = useTranslation();
  const setHovered = useSetAtom(hoveredFunnIdAtom);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(funn.title);
  const [note, setNote] = useState(funn.note ?? '');
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Keyboard navigation moves the selection; the row it lands on has to
  // come into view on its own.
  useEffect(() => {
    if (selected) {
      rowRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  // A realtime update to the record while the row sits open would
  // otherwise be overwritten by the stale draft on the next blur.
  useEffect(() => {
    if (!editing) {
      setTitle(funn.title);
      setNote(funn.note ?? '');
    }
  }, [funn.title, funn.note, editing]);

  // Existing records save on blur — no Lagre/Avbryt pair for a field you
  // are editing in place. Drafts (new funn) are still forms; see
  // FunnDraft.
  const commit = () => {
    const nextTitle = title.trim();
    const nextNote = note.trim();
    if (nextTitle.length === 0) {
      setTitle(funn.title);
      return;
    }
    if (nextTitle === funn.title && nextNote === (funn.note ?? '')) return;
    onSaveMeta(funn, nextTitle, nextNote);
  };

  return (
    <div
      ref={rowRef}
      className={cx(
        styles.row,
        selected && styles.rowSelected,
        editing && styles.rowEditing,
        deleted && styles.rowDeleted,
      )}
      onMouseEnter={() => setHovered(funn.id)}
      onMouseLeave={() => setHovered(null)}
      onClick={() => !editing && !deleted && onSelect(funn)}
      title={editing || deleted ? undefined : t('localities.funn.actions.zoom')}
    >
      <div className={styles.head}>
        <div className={styles.main}>
          {editing ? (
            <div className={styles.editor}>
              <Input
                value={title}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
                onBlur={commit}
                maxLength={200}
              />
              <NoteInput
                value={note}
                onChange={setNote}
                onBlur={commit}
                placeholder={t('localities.funn.draft.notePlaceholder')}
              />
              <div className={styles.editorActions}>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    commit();
                    setEditing(false);
                  }}
                >
                  {t('localities.funn.actions.done')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.title}>{funn.title}</div>
              {funn.note && <div className={styles.note}>{funn.note}</div>}
            </>
          )}
        </div>
        {!editing && (
          <div className={styles.actions}>
            {/* A tombstoned row keeps its badge but loses every verb that
                would change it: the only decision left on it is whether it
                goes. */}
            <StatusPicker
              value={funn.status}
              editable={editable && !deleted}
              onChange={(s) => onStatus(funn, s)}
            />
            {editable &&
              (deleted ? (
                <Button
                  size="xs"
                  variant="secondary"
                  leftIcon="undo"
                  onClick={(e: MouseEvent) => {
                    e.stopPropagation();
                    onRestore(funn.id);
                  }}
                >
                  {t('localities.edit.restore')}
                </Button>
              ) : (
                <RowMenu
                  onEditText={() => setEditing(true)}
                  onEditGeometry={() => onEditGeometry(funn)}
                  onDelete={() => onDelete(funn)}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const FunnList = ({
  items,
  editable,
  selectedId,
  deletedIds,
  onSelect,
  onStatus,
  onSaveMeta,
  onEditGeometry,
  onDelete,
  onRestore,
}: {
  items: LocalityFindRecord[] | null;
  editable: boolean;
  selectedId: string | null;
  deletedIds: ReadonlySet<string>;
  onSelect: (f: LocalityFindRecord) => void;
  onStatus: (f: LocalityFindRecord, s: LocalityFindStatus) => void;
  onSaveMeta: (f: LocalityFindRecord, title: string, note: string) => void;
  onEditGeometry: (f: LocalityFindRecord) => void;
  onDelete: (f: LocalityFindRecord) => void;
  onRestore: (id: string) => void;
}) => {
  const { t } = useTranslation();
  const setHovered = useSetAtom(hoveredFunnIdAtom);

  // The halo has no business outliving the list it belongs to.
  useEffect(() => () => setHovered(null), [setHovered]);

  if (items == null) {
    return (
      <div className={styles.busy}>
        <Spinner size={14} />
        {t('localities.funn.loading')}
      </div>
    );
  }

  if (items.length === 0) {
    return <p className={styles.empty}>{t('localities.funn.empty')}</p>;
  }

  return (
    <div className={styles.list}>
      {items.map((f) => (
        <FunnRow
          key={f.id}
          funn={f}
          editable={editable}
          selected={f.id === selectedId}
          deleted={deletedIds.has(f.id)}
          onSelect={onSelect}
          onStatus={onStatus}
          onSaveMeta={onSaveMeta}
          onEditGeometry={onEditGeometry}
          onDelete={onDelete}
          onRestore={onRestore}
        />
      ))}
    </div>
  );
};
