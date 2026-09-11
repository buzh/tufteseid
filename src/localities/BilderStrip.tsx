import { useSetAtom } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AttachmentKind,
  AttachmentRecord,
  getAttachmentUrl,
} from '../api/attachments';
import { recreateViewAtom } from '../shell/useRecreateView';
import {
  Badge,
  Button,
  ConfirmPopover,
  cx,
  Icon,
  IconButton,
  Input,
  type MaterialSymbol,
  Spinner,
  Tooltip,
} from '../ui';
import styles from './BilderStrip.module.css';
import { bilderStripOpenAtom } from './toolAtoms';
import type { LocalityWorkspaceApi } from './useLocalityWorkspace';
import { canPinBilde } from './usePinnedBilde';
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
        console.warn('[BilderStrip] url failed', e);
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

/*
 * One frame of the rail.
 *
 * Scrolls itself into view when it becomes the active one, because ←/→ walk
 * the strip and the twelfth image is off the right-hand end of it — a
 * keyboard step that changes the map but not the rail would leave you unable
 * to see what you are looking at.
 */
const Frame = ({
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
  const ref = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!selected) return;
    ref.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    });
  }, [selected]);

  return (
    <button
      ref={ref}
      type="button"
      className={cx(styles.frame, selected && styles.frameOn)}
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
          className={styles.frameImage}
        />
      ) : (
        <span className={styles.frameBusy}>
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
  );
};

/*
 * What you can do with the image the strip is pointing at.
 *
 * The four verbs of §4.2, and all four are reads: Vis i ruta (which picking
 * the frame already did), Toning, Gjenskap, and the original. Delete and the
 * caption are the writes, and they are the two things the strip hides in show
 * — the caption as `readOnly` rather than absent, because a caption is the
 * record's content and dimming it would hide what the exhibit says.
 */
const Detail = ({
  ws,
  rec,
}: {
  ws: LocalityWorkspaceApi;
  rec: AttachmentRecord;
}) => {
  const { t } = useTranslation();
  const recreate = useSetAtom(recreateViewAtom);
  const [caption, setCaption] = useState(rec.caption ?? '');

  useEffect(() => {
    setCaption(rec.caption ?? '');
  }, [rec.id, rec.caption]);

  const { pinned } = ws;
  const isPinned = pinned.pinnedId === rec.id;
  const pinnable = canPinBilde(rec);
  // Absent rather than disabled, per §4.2: a screenshot has no view behind it
  // to go back to, which is a different statement from "you may not".
  const spec = viewSpecOf(rec);

  const openOriginal = () => {
    getAttachmentUrl(rec)
      .then((u) => window.open(u, '_blank', 'noopener'))
      .catch((e) => console.warn('[BilderStrip] open failed', e));
  };

  const commitCaption = () => {
    if (caption.trim() === (rec.caption ?? '')) return;
    ws.setBildeCaption(rec, caption.trim());
  };

  return (
    <div className={styles.detail}>
      <div className={styles.detailMain}>
        <div className={styles.detailHead}>
          <Badge>{t(`localities.bilder.kind.${rec.kind}`)}</Badge>
          <MetaLine rec={rec} />
        </div>
        <Input
          value={caption}
          readOnly={!ws.canEdit}
          placeholder={t('localities.bilder.captionPlaceholder')}
          maxLength={200}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={commitCaption}
        />
        {pinned.pinnedFailed && isPinned && (
          <p className={styles.metaLine}>{t('localities.bilder.loadFailed')}</p>
        )}
      </div>

      <div className={styles.actions}>
        {/* Only the way *back* on: picking a frame already laid it down. This
            appears when the two have drifted apart, which happens exactly
            once — entering Terreng takes the overlay slot and the pin stands
            down (map/groundOverlay.ts), leaving the card still selected. */}
        {pinnable && !isPinned && (
          <Button
            size="sm"
            leftIcon="visibility"
            onClick={() => pinned.pin(rec.id)}
          >
            {t('localities.bilder.showOnMap')}
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
        {ws.canEdit && (
          <ConfirmPopover
            title={t('localities.bilder.confirmDelete')}
            confirmLabel={t('localities.bilder.delete')}
            cancelLabel={t('shared.cancel')}
            onConfirm={() => ws.removeBilde(rec)}
            trigger={(props) => (
              <Button {...props} size="sm" palette="red" leftIcon="delete">
                {t('localities.bilder.delete')}
              </Button>
            )}
          />
        )}
      </div>

      {/* Beside the caption, not under the rail (§4.3), and only while the
          image is actually on the map — a fade control over nothing is a
          control with no effect. Same plain range input as the terrain
          sliders, because what is being watched while it is dragged is the
          ground underneath. */}
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
 * Show mode's bottom edge: the filmstrip (docs/lokalitet-view.md §4.3).
 *
 * A rail of the lokalitet's images in order, the active one ringed, its
 * caption and verbs under it. ←/→ walk it from `useWorkspaceKeys`, and the
 * ground does not move as you walk — so stepping the strip is flipping
 * between readings of one rectangle in register, which is the curtain's trick
 * and the flyfoto temporal stack's trick applied to the images somebody
 * already decided were worth keeping.
 *
 * It replaced the dock's Bilder section, and the shape changed with the edge:
 * a grid of squares down a column reads as an inventory, a rail along the
 * bottom reads as a sequence. Nothing here writes in show — the caption goes
 * `readOnly` and Slett is absent — and the upload tile is gone entirely,
 * because that verb is on the row's `⋮` and two copies of it were two places
 * to keep the optimistic list update right.
 *
 * This is one of three things that may occupy the bottom slot, and never at
 * the same time as another: `LocalityRibbon` is where that rule is enforced.
 */
export const BilderStrip = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const setOpen = useSetAtom(bilderStripOpenAtom);
  const items = ws.attachmentItems;
  const active = items?.find((it) => it.id === ws.activeBildeId) ?? null;
  const walkable = (items?.length ?? 0) > 1;

  return (
    <div className={styles.strip} data-chrome="bottom">
      {/* Above the rail, not a frame in it: the images the pack has already
          saved are in that rail, and a placeholder among them would be read
          as one more that failed. */}
      {ws.starterStep != null && (
        <div className={styles.busy}>
          <Spinner size={14} />
          {t('localities.tools.starterStep', { style: ws.starterStep })}
        </div>
      )}

      <div className={styles.railRow}>
        <IconButton
          icon="chevron_left"
          size="sm"
          palette="gray"
          disabled={!walkable}
          aria-label={t('localities.bilder.previous')}
          onClick={() => ws.stepBilde(-1)}
        />

        <div className={styles.rail}>
          {items == null ? (
            <div className={styles.busy}>
              <Spinner size={14} />
              {t('localities.bilder.loading')}
            </div>
          ) : items.length === 0 ? (
            ws.starterStep == null && (
              <p className={styles.empty}>{t('localities.bilder.empty')}</p>
            )
          ) : (
            items.map((rec) => (
              <Frame
                key={rec.id}
                rec={rec}
                selected={rec.id === ws.activeBildeId}
                onClick={() => ws.selectBilde(rec.id)}
              />
            ))
          )}
        </div>

        <IconButton
          icon="chevron_right"
          size="sm"
          palette="gray"
          disabled={!walkable}
          aria-label={t('localities.bilder.next')}
          onClick={() => ws.stepBilde(1)}
        />

        <Tooltip label={t('localities.bilder.hideStrip')}>
          <IconButton
            icon="bottom_panel_close"
            size="sm"
            palette="gray"
            aria-label={t('localities.bilder.hideStrip')}
            onClick={() => setOpen(false)}
          />
        </Tooltip>
      </div>

      {active && <Detail key={active.id} ws={ws} rec={active} />}
    </div>
  );
};
