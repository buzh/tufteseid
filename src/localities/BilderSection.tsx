import { toaster } from '@kvib/react';
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
import {
  Badge,
  Button,
  Dialog,
  Icon,
  IconButton,
  Input,
  type MaterialSymbol,
  Spinner,
} from '../ui';
import { lightboxOpenAtom } from './atoms';
import styles from './BilderSection.module.css';

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

  useEffect(() => {
    setUrl(null);
    setFailed(false);
  }, [rec?.id]);

  useEffect(() => {
    if (!rec) return;
    let cancelled = false;
    getAttachmentUrl(rec, failed ? undefined : thumb)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch((e) => console.warn('[BilderSection] url failed', e));
    return () => {
      cancelled = true;
    };
    // `rec` is read, not depended on: the list reloads on every realtime
    // event and a fresh object identity would refetch every token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.id, rec?.file, thumb, failed]);

  return { url, onError: () => setFailed(true) };
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
  onOpen,
}: {
  rec: AttachmentRecord;
  onOpen: () => void;
}) => {
  const { url, onError } = useAttachmentUrl(rec, '200x200');
  return (
    <div className={styles.cell}>
      <button
        type="button"
        className={styles.tile}
        title={rec.caption || rec.kind}
        onClick={onOpen}
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
            <Spinner size={14} />
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

// Full-size view. Previously this was window.open into a new tab, which
// loses the caption, the metadata and the way back.
const Lightbox = ({
  items,
  index,
  isMine,
  onIndex,
  onClose,
  onDeleted,
  onCaption,
}: {
  items: AttachmentRecord[];
  index: number;
  isMine: boolean;
  onIndex: (i: number) => void;
  onClose: () => void;
  onDeleted: (rec: AttachmentRecord) => void;
  onCaption: (rec: AttachmentRecord, caption: string) => void;
}) => {
  const { t } = useTranslation();
  const rec = items[index] ?? null;
  const { url, onError } = useAttachmentUrl(rec, '800x0');
  const [caption, setCaption] = useState(rec?.caption ?? '');
  // Confirm inline rather than with ConfirmPopover: a modal <dialog> paints
  // in the browser's top layer, and Popover portals to <body> — which is
  // underneath it and inert. Any anchored overlay inside a dialog has to be
  // rendered as part of the dialog's own subtree.
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setCaption(rec?.caption ?? '');
  }, [rec?.id, rec?.caption]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA'].includes(target.tagName)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < items.length - 1) {
        onIndex(index + 1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, items.length, onIndex]);

  if (!rec) return null;

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
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t('localities.bilder.heading')}
      closeLabel={t('shared.close')}
      className={styles.lightbox}
      footer={
        confirming ? (
          <>
            <span className={styles.confirmText}>
              {t('localities.bilder.confirmDelete')}
            </span>
            <Button
              size="sm"
              palette="gray"
              onClick={() => setConfirming(false)}
            >
              {t('shared.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              palette="red"
              onClick={() => onDeleted(rec)}
            >
              {t('localities.bilder.delete')}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" leftIcon="open_in_new" onClick={openOriginal}>
              {t('localities.bilder.openOriginal')}
            </Button>
            {isMine && (
              <Button
                size="sm"
                palette="red"
                leftIcon="delete"
                onClick={() => setConfirming(true)}
              >
                {t('localities.bilder.delete')}
              </Button>
            )}
          </>
        )
      }
    >
      <div className={styles.viewer}>
        <div className={styles.stage}>
          {url ? (
            <img
              src={url}
              alt={rec.caption || rec.kind}
              onError={onError}
              className={styles.stageImage}
            />
          ) : (
            <Spinner size={28} />
          )}
          {items.length > 1 && (
            <>
              <IconButton
                icon="chevron_left"
                aria-label={t('localities.bilder.previous')}
                palette="gray"
                className={styles.navPrev}
                disabled={index === 0}
                onClick={() => onIndex(index - 1)}
              />
              <IconButton
                icon="chevron_right"
                aria-label={t('localities.bilder.next')}
                palette="gray"
                className={styles.navNext}
                disabled={index === items.length - 1}
                onClick={() => onIndex(index + 1)}
              />
            </>
          )}
        </div>

        <div className={styles.viewerMeta}>
          <Badge>{t(`localities.bilder.kind.${rec.kind}`)}</Badge>
          <span className={styles.counter}>
            {index + 1} / {items.length}
          </span>
        </div>

        <Input
          value={caption}
          disabled={!isMine}
          placeholder={t('localities.bilder.captionPlaceholder')}
          maxLength={200}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={commitCaption}
        />
        <MetaLine rec={rec} />
      </div>
    </Dialog>
  );
};

/**
 * The Bilder column of the tray.
 *
 * Upload lives in the workspace controller rather than here: the same verb
 * is on the lokalitet ribbon row, and two copies of the create-attachment
 * call would be two places to keep the optimistic list update right.
 */
export const BilderSection = ({
  isMine,
  items,
  setItems,
  uploading,
  onUpload,
}: {
  isMine: boolean;
  items: AttachmentRecord[] | null;
  setItems: Dispatch<SetStateAction<AttachmentRecord[] | null>>;
  uploading: boolean;
  onUpload: (file: File) => void;
}) => {
  const { t } = useTranslation();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const setLightboxOpen = useSetAtom(lightboxOpenAtom);

  // The workspace's keyboard layer stands down while this is up.
  useEffect(() => {
    setLightboxOpen(openIndex != null);
    return () => setLightboxOpen(false);
  }, [openIndex, setLightboxOpen]);

  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onUpload(file);
  };

  const remove = async (rec: AttachmentRecord) => {
    try {
      await deleteAttachment(rec.id);
      setItems((prev) => (prev ? prev.filter((it) => it.id !== rec.id) : prev));
      setOpenIndex(null);
    } catch (e) {
      console.warn('[BilderSection] delete failed', e);
      toaster.error({ title: t('localities.workspace.saveFailed') });
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
      toaster.error({ title: t('localities.workspace.saveFailed') });
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

  return (
    <>
      {items.length === 0 && (
        <p className={styles.empty}>{t('localities.bilder.empty')}</p>
      )}
      <div className={styles.grid}>
        {isMine && (
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
        {items.map((rec, i) => (
          <Thumb key={rec.id} rec={rec} onOpen={() => setOpenIndex(i)} />
        ))}
      </div>

      {openIndex != null && (
        <Lightbox
          items={items}
          index={Math.min(openIndex, items.length - 1)}
          isMine={isMine}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          onDeleted={remove}
          onCaption={setCaption}
        />
      )}
    </>
  );
};
