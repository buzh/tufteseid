/*
 * The parts the two bottom-edge surfaces share (docs/lokalitet-view.md §4.3).
 *
 * Show gets a filmstrip and edit gets a carousel, and they are different
 * shapes on purpose — but they are showing the same records, so the token
 * dance that fetches an image, the line that says which dataset it came from,
 * the caption field and the fade slider have to behave identically in both.
 * Two copies of `useAttachmentUrl` in particular would be two chances to get
 * the protected-file fallback wrong.
 *
 * Verbs live here too when both stances have them (Gjenskap, the original,
 * Vis i ruta) and stay in the surface when only one does — deleting is
 * carousel-only because nothing in show writes (§2).
 */

import { useSetAtom } from 'jotai';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type AttachmentKind,
  type AttachmentRecord,
  getAttachmentUrl,
} from '../api/attachments';
import { recreateViewAtom } from '../shell/useRecreateView';
import { Badge, Button, Input, type MaterialSymbol } from '../ui';
import styles from './bilderCommon.module.css';
import type { LocalityWorkspaceApi } from './useLocalityWorkspace';
import { viewSpecOf } from './viewSpec';

// `landscape` is what the ribbon already uses for LiDAR mode, so an
// extract carries the same mark here. (Material Symbols' `terrain` isn't
// in the set material-symbols ships types for.)
export const KIND_ICON: Record<AttachmentKind, MaterialSymbol> = {
  extract: 'landscape',
  screenshot: 'photo_camera',
  upload: 'image',
  flyfoto: 'satellite_alt',
};

// Tokened URLs are async (the file field is protected), so every image
// needs a small fetch-then-render dance. `thumb` falls back to the
// original when PB can't generate one — it regularly can't for the huge
// stitched extract PNGs.
export const useAttachmentUrl = (
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
        console.warn('[bilder] url failed', e);
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

/** A subtle one-liner: the meta line's twin, for anything else that small. */
export const Note = ({ children }: { children: ReactNode }) => (
  <p className={styles.metaLine}>{children}</p>
);

export const MetaLine = ({ rec }: { rec: AttachmentRecord }) => {
  const meta = rec.meta ?? {};
  const parts = [
    typeof meta.sourceLabel === 'string' ? meta.sourceLabel : null,
    typeof meta.style === 'string' ? meta.style : null,
    typeof meta.metresPerPx === 'number' ? `${meta.metresPerPx} m/px` : null,
  ].filter((s): s is string => !!s);
  if (parts.length === 0) return null;
  return <p className={styles.metaLine}>{parts.join(' · ')}</p>;
};

/** Kind, cover and concealment, said as chips. */
export const BildeBadges = ({
  ws,
  rec,
}: {
  ws: LocalityWorkspaceApi;
  rec: AttachmentRecord;
}) => {
  const { t } = useTranslation();
  return (
    <>
      <Badge>{t(`localities.bilder.kind.${rec.kind}`)}</Badge>
      {ws.coverBildeId === rec.id && (
        <Badge palette="blue">{t('localities.bilder.cover')}</Badge>
      )}
      {rec.hidden && (
        <Badge palette="yellow">{t('localities.bilder.hidden')}</Badge>
      )}
    </>
  );
};

/*
 * The caption. `readOnly` rather than absent in show, per §8.1: a caption is
 * the record's content, and dimming what the exhibit says would hide it.
 *
 * Local state committed on blur, so a realtime reload mid-sentence cannot
 * rewrite the field under the cursor.
 */
export const CaptionField = ({
  ws,
  rec,
}: {
  ws: LocalityWorkspaceApi;
  rec: AttachmentRecord;
}) => {
  const { t } = useTranslation();
  const [caption, setCaption] = useState(rec.caption ?? '');

  useEffect(() => {
    setCaption(rec.caption ?? '');
  }, [rec.id, rec.caption]);

  return (
    <Input
      value={caption}
      readOnly={!ws.canEdit}
      placeholder={t('localities.bilder.captionPlaceholder')}
      maxLength={200}
      onChange={(e) => setCaption(e.target.value)}
      onBlur={() => {
        if (caption.trim() === (rec.caption ?? '')) return;
        ws.setBildeCaption(rec, caption.trim());
      }}
    />
  );
};

/** How strongly the pinned image covers the ground under it. */
export const FadeControl = ({
  pinned,
}: {
  pinned: LocalityWorkspaceApi['pinned'];
}) => {
  const { t } = useTranslation();
  return (
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
  );
};

/**
 * Put the map back the way it was when this image was taken.
 *
 * Absent rather than disabled where there is no view behind the record
 * (§4.2): a screenshot has nothing to go back to, which is a different
 * statement from "you may not go back to it".
 */
export const RecreateButton = ({ rec }: { rec: AttachmentRecord }) => {
  const { t } = useTranslation();
  const recreate = useSetAtom(recreateViewAtom);
  const spec = viewSpecOf(rec);
  if (!spec) return null;
  return (
    <Button
      size="sm"
      leftIcon="restart_alt"
      title={t('localities.bilder.recreateHint')}
      onClick={() => recreate(spec)}
    >
      {t('localities.bilder.recreate')}
    </Button>
  );
};

/** The full-size file in a tab of its own — which is also how it is saved. */
export const OpenOriginalButton = ({ rec }: { rec: AttachmentRecord }) => {
  const { t } = useTranslation();
  return (
    <Button
      size="sm"
      leftIcon="open_in_new"
      onClick={() => {
        getAttachmentUrl(rec)
          .then((u) => window.open(u, '_blank', 'noopener'))
          .catch((e) => console.warn('[bilder] open failed', e));
      }}
    >
      {t('localities.bilder.openOriginal')}
    </Button>
  );
};
