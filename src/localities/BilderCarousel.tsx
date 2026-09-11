import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { AttachmentRecord } from '../api/attachments';
import {
  Button,
  ConfirmPopover,
  cx,
  Icon,
  IconButton,
  Spinner,
  Tooltip,
} from '../ui';
import {
  BildeBadges,
  CaptionField,
  FadeControl,
  MetaLine,
  Note,
  OpenOriginalButton,
  PinFace,
  PinRetryButton,
  RecreateButton,
  useAttachmentUrl,
  usePinFace,
} from './bilderCommon';
import styles from './BilderCarousel.module.css';
import { bilderStripOpenAtom } from './toolAtoms';
import type { LocalityWorkspaceApi } from './useLocalityWorkspace';
import { canPinBilde } from './usePinnedBilde';

/** The card itself: one bilde, as large as the surface will allow. */
const Card = ({ rec }: { rec: AttachmentRecord }) => {
  const { t } = useTranslation();
  // The 800 px thumbnail rather than the original: a stitched extract is
  // routinely 4000 px square, and this frame is 180 px tall. `Åpne original`
  // is how you look at the real thing.
  const { url, error, onError } = useAttachmentUrl(rec, '800x0');
  // An unpinned View shows what it is waiting for instead of an image, and
  // the card keeps its size either way: the carousel is one big frame, and a
  // stage that collapses between cards is a stage you cannot walk (§4.1.2).
  const face = usePinFace(rec);

  return (
    <div className={cx(styles.card, rec.hidden && styles.cardHidden)}>
      {face ? (
        <PinFace rec={rec} />
      ) : url ? (
        <img
          src={url}
          alt={rec.caption || rec.kind}
          onError={onError}
          className={styles.cardImage}
        />
      ) : (
        <span className={styles.cardBusy}>
          {error ? (
            <>
              <Icon icon="broken_image" size={18} />
              {t('localities.bilder.loadFailed')}
            </>
          ) : (
            <Spinner size={16} />
          )}
        </span>
      )}
    </div>
  );
};

/**
 * Edit mode's bottom edge: the carousel (docs/lokalitet-view.md §4.3).
 *
 * The same slot show fills with a filmstrip, filled with one card at a time
 * instead — and everything that writes. Caption, position in the exhibit
 * order, hide, delete, and the original; §2's rule that show writes nothing
 * is enforced here, by the write verbs simply not existing in the other
 * occupant rather than being greyed out in a shared one.
 *
 * Two differences from the rail that are easy to miss:
 *
 * - The concealed images are here, marked. Concealment is one of the things
 *   you came to change, and a curation control whose effect you cannot see is
 *   not a control. That is `bilderItems` doing it, not this component.
 * - **Walking the carousel does not put images on the map.** The ground
 *   overlay is one slot shared with the live terrain render, so a card that
 *   claimed it on arrival would knock a render down every time `Behold`
 *   landed a new image and moved the cursor. `Vis i ruta` is a verb here.
 *
 * One of three things that may occupy the bottom slot, and never at the same
 * time as another: `LocalityRibbon` enforces that.
 */
export const BilderCarousel = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const setOpen = useSetAtom(bilderStripOpenAtom);
  const { pinned } = ws;
  const items = ws.bilderItems;
  const count = items?.length ?? 0;
  const index = items?.findIndex((it) => it.id === ws.activeBildeId) ?? -1;
  const active = index >= 0 ? (items?.[index] ?? null) : null;
  const walkable = count > 1;

  // A carousel with no card showing is a blank panel: unlike the rail, there
  // is no other content to look at while nothing is selected. So it lands on
  // the first image, and on the one that replaces a deleted one.
  const { selectBilde, activeBildeId } = ws;
  useEffect(() => {
    if (!items || items.length === 0 || activeBildeId) return;
    selectBilde(items[0].id);
  }, [items, activeBildeId, selectBilde]);

  const isPinned = active != null && pinned.pinnedId === active.id;

  return (
    <div className={styles.carousel} data-chrome="bottom">
      <div className={styles.head}>
        {ws.starterBusy && (
          <span className={styles.busy}>
            <Spinner size={14} />
            {t('localities.tools.starterBusy')}
          </span>
        )}
        {count > 0 && (
          <span className={styles.position}>
            {t('localities.bilder.position', {
              index: Math.max(index, 0) + 1,
              count,
            })}
          </span>
        )}
        <span className={styles.spacer} />
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

      <div className={styles.stage}>
        <IconButton
          icon="chevron_left"
          size="sm"
          palette="gray"
          disabled={!walkable}
          aria-label={t('localities.bilder.previous')}
          onClick={() => ws.stepBilde(-1)}
        />
        {items == null ? (
          <div className={styles.card}>
            <span className={styles.cardBusy}>
              <Spinner size={16} />
              {t('localities.bilder.loading')}
            </span>
          </div>
        ) : active ? (
          <Card key={active.id} rec={active} />
        ) : (
          <div className={styles.card}>
            <p className={styles.empty}>
              {!ws.starterBusy && t('localities.bilder.empty')}
            </p>
          </div>
        )}
        <IconButton
          icon="chevron_right"
          size="sm"
          palette="gray"
          disabled={!walkable}
          aria-label={t('localities.bilder.next')}
          onClick={() => ws.stepBilde(1)}
        />
      </div>

      {active && (
        <div className={styles.body}>
          <div className={styles.bodyMain}>
            <div className={styles.bodyHead}>
              <BildeBadges ws={ws} rec={active} />
              <MetaLine rec={active} />
            </div>
            <CaptionField ws={ws} rec={active} />
            {pinned.pinnedFailed && isPinned && (
              <Note>{t('localities.bilder.loadFailed')}</Note>
            )}
          </div>

          <div className={styles.actions}>
            {/* An explicit verb here, unlike in show where picking a frame is
                what puts the image down. Both directions, because the only
                other way off the ground would be to walk to another card,
                and "look at the next one" is not what "take this one off the
                map" means. */}
            {canPinBilde(active) && (
              <Button
                size="sm"
                leftIcon={isPinned ? 'visibility_off' : 'visibility'}
                onClick={() => pinned.pin(isPinned ? null : active.id)}
              >
                {isPinned
                  ? t('localities.bilder.hideFromMap')
                  : t('localities.bilder.showOnMap')}
              </Button>
            )}
            <RecreateButton rec={active} />
            <PinRetryButton ws={ws} rec={active} />
            <OpenOriginalButton ws={ws} rec={active} />

            {/* Position in the exhibit order (§4.4). The index handed to
                `reorderBilde` is a position in the *unfiltered* list — which
                is the same array as `bilderItems` here, since edit hides
                nothing from itself. */}
            <Tooltip label={t('localities.bilder.moveEarlier')}>
              <IconButton
                icon="arrow_back"
                size="sm"
                palette="gray"
                disabled={index <= 0}
                aria-label={t('localities.bilder.moveEarlier')}
                onClick={() => ws.reorderBilde(active.id, index - 1)}
              />
            </Tooltip>
            <Tooltip label={t('localities.bilder.moveLater')}>
              <IconButton
                icon="arrow_forward"
                size="sm"
                palette="gray"
                disabled={index < 0 || index >= count - 1}
                aria-label={t('localities.bilder.moveLater')}
                onClick={() => ws.reorderBilde(active.id, index + 1)}
              />
            </Tooltip>
            <Button
              size="sm"
              palette="gray"
              leftIcon={active.hidden ? 'visibility' : 'hide_image'}
              onClick={() => ws.setBildeHidden(active, !active.hidden)}
            >
              {active.hidden
                ? t('localities.bilder.unhide')
                : t('localities.bilder.hide')}
            </Button>
            <ConfirmPopover
              title={t('localities.bilder.confirmDelete')}
              confirmLabel={t('localities.bilder.delete')}
              cancelLabel={t('shared.cancel')}
              onConfirm={() => ws.removeBilde(active)}
              trigger={(props) => (
                <Button {...props} size="sm" palette="red" leftIcon="delete">
                  {t('localities.bilder.delete')}
                </Button>
              )}
            />
          </div>

          {isPinned && <FadeControl pinned={pinned} />}
        </div>
      )}
    </div>
  );
};
