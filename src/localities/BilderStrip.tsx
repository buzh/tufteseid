import { useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AttachmentRecord } from '../api/attachments';
import { Button, cx, Icon, IconButton, Spinner, Tooltip } from '../ui';
import {
  BildeBadges,
  CaptionField,
  FadeControl,
  KIND_ICON,
  MetaLine,
  Note,
  OpenOriginalButton,
  PinFace,
  RecreateButton,
  useAttachmentUrl,
  usePinFace,
} from './bilderCommon';
import styles from './BilderStrip.module.css';
import { bilderStripOpenAtom } from './toolAtoms';
import type { LocalityWorkspaceApi } from './useLocalityWorkspace';
import { canPinBilde } from './usePinnedBilde';

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
  isCover,
  onClick,
}: {
  rec: AttachmentRecord;
  selected: boolean;
  isCover: boolean;
  onClick: () => void;
}) => {
  const { url, error, onError } = useAttachmentUrl(rec, '200x200');
  const face = usePinFace(rec);
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
        face
          ? // The pin state *is* the frame's sentence while there are no
            // pixels: the caption describes an image nobody can see yet.
            face.label
          : error
            ? t('localities.bilder.loadFailed')
            : rec.caption || rec.kind
      }
      onClick={onClick}
    >
      {face ? (
        <PinFace rec={rec} compact />
      ) : url ? (
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
      {/* The cover is derived, so this mark is the only place it is stated —
          and it moves the moment something else is arranged in front of it. */}
      {isCover && (
        <span className={cx(styles.mark, styles.coverMark)}>
          <Icon icon="star" size={13} filled />
        </span>
      )}
    </button>
  );
};

/*
 * What you can do with the image the strip is pointing at, and it is all
 * reading: Vis i ruta (which picking the frame already did), Toning, Gjenskap
 * and the original. The caption is here too, `readOnly` rather than absent,
 * because a caption is the record's content and hiding what the exhibit says
 * would be a strange way to show it (§8.1).
 */
const Detail = ({
  ws,
  rec,
}: {
  ws: LocalityWorkspaceApi;
  rec: AttachmentRecord;
}) => {
  const { t } = useTranslation();
  const { pinned } = ws;
  const isPinned = pinned.pinnedId === rec.id;

  return (
    <div className={styles.detail}>
      <div className={styles.detailMain}>
        <div className={styles.detailHead}>
          <BildeBadges ws={ws} rec={rec} />
          <MetaLine rec={rec} />
        </div>
        <CaptionField ws={ws} rec={rec} />
        {pinned.pinnedFailed && isPinned && (
          <Note>{t('localities.bilder.loadFailed')}</Note>
        )}
      </div>

      <div className={styles.actions}>
        {/* Only the way *back* on: picking a frame already laid it down. This
            appears when the two have drifted apart, which happens exactly
            once — entering Terreng takes the overlay slot and the pin stands
            down (map/groundOverlay.ts), leaving the card still selected. */}
        {/* Unpinned Views are not offerable to the map — `canPinBilde`
            already refuses one, because there is nothing to lay down. */}
        {canPinBilde(rec) && !isPinned && (
          <Button
            size="sm"
            leftIcon="visibility"
            onClick={() => pinned.pin(rec.id)}
          >
            {t('localities.bilder.showOnMap')}
          </Button>
        )}
        <RecreateButton rec={rec} />
        {/* No retry here, and none is reachable: a pin is a write, so
            `PinRetryButton` is the carousel's. This surface is only ever
            mounted where `canAdd` is false. */}
        <OpenOriginalButton ws={ws} rec={rec} />
      </div>

      {isPinned && <FadeControl pinned={pinned} />}
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
 * bottom reads as a sequence.
 *
 * **Nothing here writes.** Not "is disabled" — is absent: the concealed
 * images are not on the rail, there is no delete, no reordering and no hide,
 * and the caption is read-only. Every one of those is in the carousel that
 * takes this slot in edit (BilderCarousel), which is what §2 means by the
 * stance being legible from across the room.
 *
 * This is one of three things that may occupy the bottom slot, and never at
 * the same time as another: `LocalityRibbon` is where that rule is enforced.
 */
export const BilderStrip = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const setOpen = useSetAtom(bilderStripOpenAtom);
  const items = ws.bilderItems;
  const active = items?.find((it) => it.id === ws.activeBildeId) ?? null;
  const walkable = (items?.length ?? 0) > 1;

  return (
    <div className={styles.strip} data-chrome="bottom">
      {/* Above the rail, not a frame in it: the images the starter set has
          already saved are in that rail, and a placeholder among them would
          be read as one more that failed. */}
      {ws.starterBusy && (
        <div className={styles.busy}>
          <Spinner size={14} />
          {t('localities.tools.starterBusy')}
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
            !ws.starterBusy && (
              <p className={styles.empty}>{t('localities.bilder.empty')}</p>
            )
          ) : (
            items.map((rec) => (
              <Frame
                key={rec.id}
                rec={rec}
                selected={rec.id === ws.activeBildeId}
                isCover={rec.id === ws.coverBildeId}
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
