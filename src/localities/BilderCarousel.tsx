import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmPopover, IconButton, Tooltip } from '../ui';
import {
  BildeBadges,
  BilderRail,
  CaptionField,
  FadeControl,
  MetaLine,
  Note,
  OpenOriginalButton,
  PinRetryButton,
  RecreateButton,
} from './bilderCommon';
import styles from './bilderCommon.module.css';
import type { LocalityWorkspaceApi } from './useLocalityWorkspace';
import { canPinBilde } from './usePinnedBilde';

/**
 * Edit mode's bottom edge: the carousel (docs/lokalitet-view.md §4.3).
 *
 * The same rail show fills, plus everything that writes: caption, position in
 * the exhibit order, hide, delete, and the original. §2's rule that show
 * writes nothing is enforced by those verbs simply not existing in the other
 * occupant rather than being greyed out in a shared one.
 *
 * It used to be one large card at a time, on the argument that deciding a
 * caption off an 88×64 thumbnail is deciding it blind. That was true of
 * judging one image and false of arranging a set: curating an exhibit is
 * mostly deciding what follows what, and a reorder you cannot watch happen is
 * a reorder you have to verify afterwards. So the rail is the shape in both
 * stances, and the big look at one picture is `Åpne originalen` or
 * `Vis i ruta` — which put it on the ground the render was made from, at full
 * size, which is better than a 180 px letterbox ever was.
 *
 * Three things about it that are easy to miss:
 *
 * - The concealed images are here, marked. Concealment is one of the things
 *   you came to change, and a curation control whose effect you cannot see is
 *   not a control. That is `bilderItems` doing it, not this component.
 * - **Walking the rail does not put images on the map.** The ground overlay
 *   is one slot shared with the live terrain render, so a card that claimed it
 *   on arrival would knock a render down every time `Behold` landed a new
 *   image and moved the cursor. `Vis i ruta` is a verb here.
 * - **Order is dragged or stepped.** The frames drag along the rail
 *   (`useRailReorder`); the ←/→ buttons in this row do the same move for the
 *   keyboard and for touch, where the drag gesture belongs to scrolling.
 *
 * One of three things that may occupy the bottom slot, and never at the same
 * time as another: `LocalityRibbon` enforces that.
 */
export const BilderCarousel = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const { pinned } = ws;
  const items = ws.bilderItems;
  // The exhibit is the *own* records; the borrowed tail (§7) is a suffix of
  // the rail that has no position in it. `reorderBilde` clamps to that
  // boundary anyway, so counting the whole rail here would leave the last
  // `→` enabled on a move it would then refuse to make.
  const ownCount =
    items?.filter((it) => !ws.inheritedIds.has(it.id)).length ?? 0;
  const index = items?.findIndex((it) => it.id === ws.activeBildeId) ?? -1;
  const active = index >= 0 ? (items?.[index] ?? null) : null;

  // Land on the first image rather than on nothing. The rail is legible
  // either way, but entering edit is entering to change something, and a
  // surface that opens with no subject makes you pick one before you can.
  const { selectBilde, activeBildeId } = ws;
  useEffect(() => {
    if (!items || items.length === 0 || activeBildeId) return;
    selectBilde(items[0].id);
  }, [items, activeBildeId, selectBilde]);

  const isPinned = active != null && pinned.pinnedId === active.id;
  // Tombstoned by this session (§5.6, consequence 2). The frame stays on the
  // rail — walking past a gap is how you fail to notice you made one — but
  // every verb that would curate it is gone, because curating something you
  // have just thrown away is not a decision anyone needs to make.
  const deleted = active != null && ws.deletedIds.has(active.id);
  // One of the original's Files, on a copy that did not carry it (§7). It
  // sits at the end of the same rail rather than in a shelf of its own: they
  // are images of this rectangle and they belong where you are already
  // looking. Every verb but `Ta med` is gone, because none of the others has
  // anything to act on — the record is not in this lokalitet yet.
  const borrowed = active != null && ws.inheritedIds.has(active.id);

  return (
    <div className={styles.surface} data-chrome="bottom">
      <BilderRail ws={ws} onReorder={ws.reorderBilde} />

      {active && (
        <div className={styles.detail}>
          <div className={styles.detailMain}>
            <div className={styles.detailHead}>
              <BildeBadges ws={ws} rec={active} borrowed={borrowed} />
              <MetaLine rec={active} />
            </div>
            <CaptionField ws={ws} rec={active} readOnly={borrowed} />
            {pinned.pinnedFailed && isPinned && (
              <Note>{t('localities.bilder.loadFailed')}</Note>
            )}
          </div>

          <div className={styles.actions}>
            {borrowed ? (
              <>
                <span className={styles.borrowedNote}>
                  {t('localities.copy.borrowedHint')}
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  leftIcon="download"
                  disabled={ws.takingBildeId != null}
                  onClick={() => void ws.takeBilde(active)}
                >
                  {ws.takingBildeId === active.id
                    ? t('localities.copy.taking')
                    : t('localities.copy.take')}
                </Button>
                {/* Reading is not taking. The full-size file opens in a tab
                    straight from the original — which is the whole reason
                    the link back is worth having, and the reason `Ta med`
                    can afford to be elective. */}
                <OpenOriginalButton ws={ws} rec={active} />
              </>
            ) : deleted ? (
              <Button
                size="sm"
                variant="secondary"
                leftIcon="undo"
                onClick={() => ws.restoreDeleted(active.id)}
              >
                {t('localities.edit.restore')}
              </Button>
            ) : (
              <>
                {/* An explicit verb here, unlike in show where picking a frame
                    is what puts the image down. Both directions, because the
                    only other way off the ground would be to walk to another
                    card, and "look at the next one" is not what "take this one
                    off the map" means. */}
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

                {/* Position in the exhibit order (§4.4), for the keyboard and
                    for touch — dragging the frame itself is the other way,
                    and neither is the primary one. The index handed to
                    `reorderBilde` is a position in the *unfiltered* list,
                    which is the same array as `bilderItems` here since edit
                    hides nothing from itself. */}
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
                    disabled={index < 0 || index >= ownCount - 1}
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
                    <Button
                      {...props}
                      size="sm"
                      palette="red"
                      leftIcon="delete"
                    >
                      {t('localities.bilder.delete')}
                    </Button>
                  )}
                />
              </>
            )}
          </div>

          {isPinned && <FadeControl pinned={pinned} />}
        </div>
      )}
    </div>
  );
};
