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
  Menu,
  NoteInput,
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

// Every control stops its click propagating: the row zooms the map to the funn,
// and React events bubble through the tree, so even a portalled popover body
// would fire the row's handler. `Menu` does it for its own trigger and body.

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

  const badge = (
    <Badge palette={STATUS_PALETTE[value]}>
      {t(`localities.funn.status.${value}`)}
    </Badge>
  );

  if (!editable) return badge;

  return (
    <Menu
      align="end"
      width={190}
      label={t('localities.funn.status.heading')}
      title={t('localities.funn.status.heading')}
      trigger={(p) => (
        <button
          type="button"
          className={styles.statusTrigger}
          title={t('localities.funn.status.pickHint')}
          aria-expanded={p.open}
          onClick={p.onClick}
        >
          {badge}
          <Icon icon="keyboard_arrow_down" size={14} />
        </button>
      )}
      items={STATUS_ORDER.map((s) => ({
        // The same badge the row shows.
        label: (
          <Badge palette={STATUS_PALETTE[s]}>
            {t(`localities.funn.status.${s}`)}
          </Badge>
        ),
        active: s === value,
        onSelect: () => {
          if (s !== value) onChange(s);
        },
      }))}
    />
  );
};

// Delete confirms in place rather than nesting a second popover.
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

  return (
    <Menu
      align="end"
      width={230}
      label={t('localities.funn.actions.menu')}
      trigger={(p) => (
        <IconButton
          icon="more_vert"
          size="xs"
          palette="gray"
          aria-label={t('localities.funn.actions.menu')}
          aria-expanded={p.open}
          onClick={p.onClick}
        />
      )}
      items={[
        {
          icon: 'edit',
          label: t('localities.funn.actions.edit'),
          onSelect: onEditText,
        },
        {
          icon: 'draw',
          label: t('localities.funn.actions.editGeometry'),
          onSelect: onEditGeometry,
        },
        {
          icon: 'delete',
          label: t('localities.funn.actions.delete'),
          danger: true,
          confirm: {
            title: t('localities.funn.confirmDeleteShort'),
            confirmLabel: t('localities.funn.actions.delete'),
            cancelLabel: t('localities.funn.draft.cancel'),
          },
          onSelect: onDelete,
        },
      ]}
    />
  );
};

// Outside `.actions` and not gated on `editable`: everything to its right acts
// on the record, and switching a layer off writes nothing.
const VisibilitySwitch = ({
  shown,
  onToggle,
}: {
  shown: boolean;
  onToggle: () => void;
}) => {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={shown}
      className={styles.switch}
      title={t(shown ? 'localities.funn.hideOne' : 'localities.funn.showOne')}
      aria-label={t(
        shown ? 'localities.funn.hideOne' : 'localities.funn.showOne',
      )}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Icon
        icon={shown ? 'check_box' : 'check_box_outline_blank'}
        size={18}
        className={shown ? styles.switchOn : styles.switchOff}
      />
    </button>
  );
};

const FunnRow = ({
  funn,
  editable,
  selected,
  deleted,
  shown,
  onToggleShown,
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
  /** Tombstoned by this session: one press from coming back. */
  deleted: boolean;
  /** On the map right now. Nothing to do with `deleted` or `hidden`. */
  shown: boolean;
  onToggleShown: (id: string) => void;
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

  // Keyboard navigation moves the selection; the row has to follow.
  useEffect(() => {
    if (selected) {
      rowRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  // Or a realtime update arriving while the row sits open is overwritten by
  // the stale draft on the next blur.
  useEffect(() => {
    if (!editing) {
      setTitle(funn.title);
      setNote(funn.note ?? '');
    }
  }, [funn.title, funn.note, editing]);

  // Existing records save on blur; drafts are still forms (see FunnDraft).
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
        {/* A tombstoned funn is already off the map. */}
        {!deleted && (
          <VisibilitySwitch
            shown={shown}
            onToggle={() => onToggleShown(funn.id)}
          />
        )}
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
            {/* A tombstoned row keeps its badge but loses every verb. */}
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
  drawable,
  selectedId,
  deletedIds,
  switchedOffIds,
  onToggleShown,
  onSelect,
  onStatus,
  onSaveMeta,
  onEditGeometry,
  onDelete,
  onRestore,
}: {
  items: LocalityFindRecord[] | null;
  editable: boolean;
  /**
   * `canAdd`, not `canEdit`: the empty state invites the reader to draw, and an
   * admin in edit may reshape somebody's funn but never add one.
   */
  drawable: boolean;
  selectedId: string | null;
  deletedIds: ReadonlySet<string>;
  /** Switched off in this session: view state, never stored. */
  switchedOffIds: ReadonlySet<string>;
  onToggleShown: (id: string) => void;
  onSelect: (f: LocalityFindRecord) => void;
  onStatus: (f: LocalityFindRecord, s: LocalityFindStatus) => void;
  onSaveMeta: (f: LocalityFindRecord, title: string, note: string) => void;
  onEditGeometry: (f: LocalityFindRecord) => void;
  onDelete: (f: LocalityFindRecord) => void;
  onRestore: (id: string) => void;
}) => {
  const { t } = useTranslation();
  const setHovered = useSetAtom(hoveredFunnIdAtom);

  // The halo must not outlive the list.
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
    return (
      <p className={styles.empty}>
        {t(drawable ? 'localities.funn.empty' : 'localities.funn.emptyRead')}
      </p>
    );
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
          shown={!switchedOffIds.has(f.id)}
          onToggleShown={onToggleShown}
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
