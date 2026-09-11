import { useSetAtom } from 'jotai';
import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AttachmentKind,
  AttachmentRecord,
  deleteAttachment,
  getAttachmentUrl,
  updateAttachmentCaption,
} from '../api/attachments';
import { recreateViewAtom } from '../shell/useRecreateView';
import {
  Badge,
  Button,
  ConfirmPopover,
  cx,
  Icon,
  Input,
  type MaterialSymbol,
  Spinner,
  toast,
} from '../ui';
import styles from './BilderSection.module.css';
import { canPinBilde, type usePinnedBilde } from './usePinnedBilde';
import { viewSpecOf } from './viewSpec';

// `landscape` is what the ribbon already uses for LiDAR mode, so an
// extract carries the same mark here. (Material Symbols' `terrain` isn't
// in the set material-symbols ships types for.)
const KIND_ICON: Record<AttachmentKind, MaterialSymbol> = {
  extract: 'landscape',
  screenshot: 'photo_camera',
  upload: 'image',
  flyfoto: 'satellite_alt',
};

// Tokened URLs are async (the file field is protected), so every image
// needs a small fetch-then-render dance. `thumb` falls back to the
// original when PB can't generate one — it regularly can't for the huge
// stitched extract PNGs.
const useAttachmentUrl = (
  rec: AttachmentRecord | null,
  thumb?: '200x200' | '800x0',
) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    setError(false);
  }, [rec?.id]);

  useEffect(() => {
    if (!rec) return;
    let cancelled = false;
    getAttachmentUrl(rec, failed ? undefined : thumb)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch((e) => {
        console.warn('[BilderSection] url failed', e);
        // Say so. Left to itself the tile keeps its spinner up forever,
        // which reads as "still loading" for something that will never
        // arrive.
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
    // `rec` is read, not depended on: the list reloads on every realtime
    // event and a fresh object identity would refetch every token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.id, rec?.file, thumb, failed]);

  return { url, error, onError: () => setFailed(true) };
};

const MetaLine = ({ rec }: { rec: AttachmentRecord }) => {
  const meta = rec.meta ?? {};
  const parts = [
    typeof meta.sourceLabel === 'string' ? meta.sourceLabel : null,
    typeof meta.style === 'string' ? meta.style : null,
    typeof meta.metresPerPx === 'number' ? `${meta.metresPerPx} m/px` : null,
  ].filter((s): s is string => !!s);
  if (parts.length === 0) return null;
  return <p className={styles.metaLine}>{parts.join(' · ')}</p>;
};

const Thumb = ({
  rec,
  selected,
  onClick,
}: {
  rec: AttachmentRecord;
  selected: boolean;
  onClick: () => void;
}) => {
  const { url, error, onError } = useAttachmentUrl(rec, '200x200');
  const { t } = useTranslation();
  return (
    <div className={styles.cell}>
      <button
        type="button"
        className={cx(styles.tile, selected && styles.tileOn)}
        aria-pressed={selected}
        title={
          error ? t('localities.bilder.loadFailed') : rec.caption || rec.kind
        }
        onClick={onClick}
      >
        {url ? (
          <img
            src={url}
            alt={rec.caption || rec.kind}
            onError={onError}
            className={styles.tileImage}
          />
        ) : (
          <span className={styles.tileBusy}>
            {error ? (
              <Icon icon="broken_image" size={18} />
            ) : (
              <Spinner size={14} />
            )}
          </span>
        )}
        <span className={styles.kindMark}>
          <Icon icon={KIND_ICON[rec.kind]} size={14} />
        </span>
      </button>
      {rec.caption && <div className={styles.caption}>{rec.caption}</div>}
    </div>
  );
};

/**
 * What you can do with the image you just picked.
 *
 * This replaced the lightbox, and the replacement is the point of the whole
 * step (docs/lokalitet-view.md §4.2). A lightbox answers "what does this file
 * look like", which for an image *of this rectangle* is the wrong question —
 * so the image goes on the map instead, in register, under the funn and the
 * Kulturminner layers, with a fade to compare it against whatever is beneath
 * it. Everything else the lightbox carried moves here unchanged: the caption
 * field, delete, the link to the original.
 *
 * Not a dialog and not anchored: a panel under the grid, so nothing the image
 * is being compared with is covered while it is being compared.
 */
const SelectionBar = ({
  rec,
  canEdit,
  pinned,
  onDeleted,
  onCaption,
}: {
  rec: AttachmentRecord;
  canEdit: boolean;
  pinned: ReturnType<typeof usePinnedBilde>;
  onDeleted: (rec: AttachmentRecord) => void;
  onCaption: (rec: AttachmentRecord, caption: string) => void;
}) => {
  const { t } = useTranslation();
  const recreate = useSetAtom(recreateViewAtom);
  const [caption, setCaption] = useState(rec.caption ?? '');

  useEffect(() => {
    setCaption(rec.caption ?? '');
  }, [rec.id, rec.caption]);

  const isPinned = pinned.pinnedId === rec.id;
  const pinnable = canPinBilde(rec);
  // Absent rather than disabled, per §4.2: a screenshot has no view behind it
  // to go back to, which is a different statement from "you may not".
  const spec = viewSpecOf(rec);

  const openOriginal = () => {
    getAttachmentUrl(rec)
      .then((u) => window.open(u, '_blank', 'noopener'))
      .catch((e) => console.warn('[BilderSection] open failed', e));
  };

  const commitCaption = () => {
    if (caption.trim() === (rec.caption ?? '')) return;
    onCaption(rec, caption.trim());
  };

  return (
    <div className={styles.selection}>
      <div className={styles.selectionHead}>
        <Badge>{t(`localities.bilder.kind.${rec.kind}`)}</Badge>
        <MetaLine rec={rec} />
      </div>

      <Input
        value={caption}
        disabled={!canEdit}
        placeholder={t('localities.bilder.captionPlaceholder')}
        maxLength={200}
        onChange={(e) => setCaption(e.target.value)}
        onBlur={commitCaption}
      />

      <div className={styles.actions}>
        {pinnable && (
          <Button
            size="sm"
            variant={isPinned ? 'primary' : undefined}
            leftIcon={isPinned ? 'visibility_off' : 'visibility'}
            onClick={() => pinned.pin(rec.id)}
          >
            {isPinned
              ? t('localities.bilder.hideOnMap')
              : t('localities.bilder.showOnMap')}
          </Button>
        )}
        {spec && (
          <Button
            size="sm"
            leftIcon="restart_alt"
            title={t('localities.bilder.recreateHint')}
            onClick={() => recreate(spec)}
          >
            {t('localities.bilder.recreate')}
          </Button>
        )}
        <Button size="sm" leftIcon="open_in_new" onClick={openOriginal}>
          {t('localities.bilder.openOriginal')}
        </Button>
        {canEdit && (
          <ConfirmPopover
            title={t('localities.bilder.confirmDelete')}
            confirmLabel={t('localities.bilder.delete')}
            cancelLabel={t('shared.cancel')}
            onConfirm={() => onDeleted(rec)}
            trigger={(props) => (
              <Button {...props} size="sm" palette="red" leftIcon="delete">
                {t('localities.bilder.delete')}
              </Button>
            )}
          />
        )}
      </div>

      {pinned.pinnedFailed && isPinned && (
        <p className={styles.metaLine}>{t('localities.bilder.loadFailed')}</p>
      )}

      {/* Only while it is actually on the map. A fade control over nothing is
          a control with no effect, and the row is short enough that appearing
          reads as "this is what you can do now". Same reasoning, and the same
          plain range input, as the terrain sliders. */}
      {isPinned && (
        <label className={styles.fade}>
          <span className={styles.fadeHead}>
            <span>{t('localities.bilder.opacity')}</span>
            <span className={styles.fadeValue}>{pinned.opacity}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={pinned.opacity}
            onChange={(e) => pinned.setOpacity(Number(e.target.value))}
          />
        </label>
      )}
    </div>
  );
};

/**
 * The Bilder section of the dock.
 *
 * Upload lives in the workspace controller rather than here: the same verb
 * is on the lokalitet ribbon row, and two copies of the create-attachment
 * call would be two places to keep the optimistic list update right.
 */
export const BilderSection = ({
  canEdit,
  canAdd,
  items,
  setItems,
  uploading,
  onUpload,
  starterStep,
  pinned,
}: {
  /** Delete an image, retitle one. An admin may; a reader may not. */
  canEdit: boolean;
  /** Put a new one in. Owners only — the create rule wants the parent too. */
  canAdd: boolean;
  items: AttachmentRecord[] | null;
  setItems: Dispatch<SetStateAction<AttachmentRecord[] | null>>;
  uploading: boolean;
  onUpload: (file: File) => void;
  /** The style the starter set is fetching, or null when it is not running. */
  starterStep: string | null;
  pinned: ReturnType<typeof usePinnedBilde>;
}) => {
  const { t } = useTranslation();
  // Seeded from the pin rather than starting empty: this section is inside a
  // collapsible, and folding it away to look at the pinned image and then
  // opening it again should come back to the image you are looking at.
  const [selectedId, setSelectedId] = useState<string | null>(
    () => pinned.pinnedId,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onUpload(file);
  };

  // One press does both: pick the image and put it on the map. Selecting
  // without showing would be a second click for the thing the click was for,
  // and the images that cannot be placed — uploads, which carry no extent —
  // are exactly the ones with nothing to show.
  const select = (rec: AttachmentRecord) => {
    if (selectedId === rec.id) {
      setSelectedId(null);
      pinned.pin(null);
      return;
    }
    setSelectedId(rec.id);
    pinned.pin(canPinBilde(rec) ? rec.id : null);
  };

  const remove = async (rec: AttachmentRecord) => {
    try {
      await deleteAttachment(rec.id);
      setItems((prev) => (prev ? prev.filter((it) => it.id !== rec.id) : prev));
      if (selectedId === rec.id) setSelectedId(null);
    } catch (e) {
      console.warn('[BilderSection] delete failed', e);
      toast.error({ title: t('localities.workspace.saveFailed') });
    }
  };

  const setCaption = async (rec: AttachmentRecord, caption: string) => {
    try {
      const updated = await updateAttachmentCaption(rec.id, caption);
      setItems((prev) =>
        prev ? prev.map((it) => (it.id === rec.id ? updated : it)) : prev,
      );
    } catch (e) {
      console.warn('[BilderSection] caption save failed', e);
      toast.error({ title: t('localities.workspace.saveFailed') });
    }
  };

  if (items == null) {
    return (
      <div className={styles.busy}>
        <Spinner size={14} />
        {t('localities.bilder.loading')}
      </div>
    );
  }

  const selected = items.find((it) => it.id === selectedId) ?? null;

  return (
    <>
      {items.length === 0 && starterStep == null && (
        <p className={styles.empty}>{t('localities.bilder.empty')}</p>
      )}
      {/* Above the grid, not a tile in it: the images the pack has already
          saved are in that grid, and a placeholder sitting among them would
          be read as a fourth one that failed. */}
      {starterStep != null && (
        <div className={styles.busy}>
          <Spinner size={14} />
          {t('localities.tools.starterStep', { style: starterStep })}
        </div>
      )}
      <div className={styles.grid}>
        {canAdd && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={pickFile}
            />
            <button
              type="button"
              className={styles.addTile}
              disabled={uploading}
              title={t('localities.bilder.upload')}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Spinner size={18} />
              ) : (
                <Icon icon="add_photo_alternate" size={22} />
              )}
              {uploading
                ? t('localities.bilder.uploading')
                : t('localities.bilder.upload')}
            </button>
          </>
        )}
        {items.map((rec) => (
          <Thumb
            key={rec.id}
            rec={rec}
            selected={rec.id === selectedId}
            onClick={() => select(rec)}
          />
        ))}
      </div>

      {selected && (
        <SelectionBar
          key={selected.id}
          rec={selected}
          canEdit={canEdit}
          pinned={pinned}
          onDeleted={remove}
          onCaption={setCaption}
        />
      )}
    </>
  );
};
