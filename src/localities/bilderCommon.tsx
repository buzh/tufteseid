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
import {
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  type AttachmentKind,
  type AttachmentRecord,
  getAttachmentUrl,
} from '../api/attachments';
import { recreateViewAtom } from '../shell/useRecreateView';
import {
  Badge,
  Button,
  Icon,
  Input,
  type MaterialSymbol,
  Spinner,
} from '../ui';
import styles from './bilderCommon.module.css';
import { isDraftId } from './draft';
import { type PinState, pinStateOf, subscribePinQueue } from './pinQueue';
import type { LocalityWorkspaceApi } from './useLocalityWorkspace';
import { isPinned, viewSpecOf } from './viewSpec';

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
    // An unpinned View has no file to ask for a token for, and asking anyway
    // is a 404 that would light the error state on a record that is perfectly
    // fine (§4.1.2). The surfaces show the pin face instead — `usePinFace`.
    if (!rec || !isPinned(rec)) return;
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

/** What the pin queue is doing about this record right now. */
export const usePinState = (id: string): PinState | undefined =>
  useSyncExternalStore(
    subscribePinQueue,
    () => pinStateOf(id),
    () => undefined,
  );

/**
 * What to draw where the image would be, on a View whose pixels do not exist
 * yet — and null on a record that has them, which is the common case.
 *
 * A **quiet per-card state**, per §5.6: not a blocking spinner over the rail
 * and not a broken-image placeholder. An unpinned View is a normal record
 * that simply has not been rendered yet, and the five faces are five
 * different sentences — not written down yet, being made, not asked for,
 * nothing there, went wrong — because only one of them is worth pressing a
 * button about.
 */
export const usePinFace = (
  rec: AttachmentRecord,
): { icon: MaterialSymbol | null; label: string } | null => {
  const { t } = useTranslation();
  const state = usePinState(rec.id);
  if (isPinned(rec)) return null;
  // A View buffered by the open transaction: the server has never heard of
  // this record, so the queue cannot have an opinion about it and the face
  // has to come from the draft instead. It says *when* rather than *what
  // went wrong*, because nothing has yet gone anywhere.
  if (isDraftId(rec.id)) {
    return { icon: 'bookmark', label: t('localities.bilder.pinBuffered') };
  }
  switch (state) {
    case 'queued':
    case 'running':
      // Spinner rather than a glyph: this one ends by itself.
      return { icon: null, label: t('localities.bilder.pinPending') };
    case 'empty':
      return { icon: 'hide_image', label: t('localities.bilder.pinEmpty') };
    case 'failed':
      return { icon: 'broken_image', label: t('localities.bilder.pinFailed') };
    default:
      // Nobody has asked. A reader over somebody else's lokalitet, or an
      // owner in show — §2 keeps the sweep on the edit side of the line.
      return { icon: 'image', label: t('localities.bilder.pinAbsent') };
  }
};

/**
 * The face itself.
 *
 * `compact` for the strip's 88×64 frames, where the sentence does not fit and
 * the frame's `title` is carrying it anyway; the carousel's card has room to
 * say it out loud.
 */
export const PinFace = ({
  rec,
  compact,
}: {
  rec: AttachmentRecord;
  compact?: boolean;
}) => {
  const face = usePinFace(rec);
  if (!face) return null;
  const size = compact ? 18 : 28;
  return (
    <div className={styles.pinFace}>
      {face.icon ? (
        <Icon icon={face.icon} size={size} />
      ) : (
        <Spinner size={compact ? 14 : 24} />
      )}
      {!compact && <span>{face.label}</span>}
    </div>
  );
};

/**
 * …and the one case worth a verb: a render that failed.
 *
 * Only failures get a button. `empty` means the source has nothing over this
 * rectangle, and offering to try again would be offering to re-learn the same
 * fact; `queued` is already happening. Owner-only, because a pin is an
 * `update` and nothing in show writes (§2).
 */
export const PinRetryButton = ({
  ws,
  rec,
}: {
  ws: LocalityWorkspaceApi;
  rec: AttachmentRecord;
}) => {
  const { t } = useTranslation();
  const state = usePinState(rec.id);
  if (!ws.canAdd || isPinned(rec) || state !== 'failed') return null;
  return (
    <Button size="sm" leftIcon="redo" onClick={() => ws.retryPin(rec)}>
      {t('localities.bilder.pinRetry')}
    </Button>
  );
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

/*
 * The full-size file in a tab of its own — which is also how it is saved.
 *
 * One of the two places that **force a pin** (§4.1.2, §12): there is no such
 * thing as downloading a row of parameters, so an unpinned View has to be
 * rendered before this can do anything at all.
 *
 * Which makes it two presses, and that is a browser constraint rather than a
 * design preference: `window.open` several seconds after the click that
 * caused it is a popup, and gets blocked. So the button says `Hent bildet`
 * while there are no pixels, spins while it makes them, and becomes `Åpne
 * originalen` — the second press is inside a gesture and opens cleanly.
 *
 * Owner-gated in the same breath, for the same reason `PinRetryButton` is: a
 * pin writes. A reader over a spec sees no button, which is honest — there is
 * nothing there to open.
 */
export const OpenOriginalButton = ({
  ws,
  rec,
}: {
  ws: LocalityWorkspaceApi;
  rec: AttachmentRecord;
}) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  // The record the pin handed back, so the label flips on the response rather
  // than waiting for the realtime event to bring the list round again.
  const [pinnedRec, setPinnedRec] = useState<AttachmentRecord | null>(null);
  const target = isPinned(rec) ? rec : pinnedRec;

  if (!target) {
    // Nothing to force a pin against while the spec is still only in the
    // draft: there is no record id the queue could PATCH. `Lagre` writes it
    // and the queue picks it up a moment later (§5.6, consequence 3).
    if (!ws.canAdd || isDraftId(rec.id)) return null;
    return (
      <Button
        size="sm"
        leftIcon="photo_library"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          ws.forcePin(rec)
            .then((pinned) => {
              if (pinned) setPinnedRec(pinned);
            })
            .catch((e) => console.warn('[bilder] force pin failed', e))
            .finally(() => setBusy(false));
        }}
      >
        {busy
          ? t('localities.bilder.pinPending')
          : t('localities.bilder.pinNow')}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      leftIcon="open_in_new"
      onClick={() => {
        getAttachmentUrl(target)
          .then((u) => window.open(u, '_blank', 'noopener'))
          .catch((e) => console.warn('[bilder] open failed', e));
      }}
    >
      {t('localities.bilder.openOriginal')}
    </Button>
  );
};
