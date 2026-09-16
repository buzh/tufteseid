import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmPopover, IconButton, Tooltip } from '../ui';
import {
  BildeBadges,
  BildeFunnPicker,
  BilderRail,
  CaptionField,
  MetaLine,
  OpenOriginalButton,
  PinRetryButton,
  PlaceUploadButton,
  SceneRestoreButton,
  SketchEditButton,
  SketchToggleButton,
} from './bilderCommon';
import styles from './bilderCommon.module.css';
import type { LocalityWorkspaceApi } from './useLocalityWorkspace';

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
 * stances, and the big look at one picture is `Åpne originalen` or the
 * member's own switch in `[Bilde ▾]` — which puts it on the ground the render
 * was made from, at full size, which is better than a 180 px letterbox ever
 * was.
 *
 * Three things about it that are easy to miss:
 *
 * - The concealed images are here, marked. Concealment is one of the things
 *   you came to change, and a curation control whose effect you cannot see is
 *   not a control. That is `bilderItems` doing it, not this component.
 * - **Picking a frame does not lay it on the map.** It did once, back when the
 *   ground was one slot and walking the rail moved what was in it; step 6
 *   turned that level into a stack with a switch per member, and the rail
 *   stopped being a map control in either stance (§13.2). The cursor moves and
 *   nothing else does.
 * - **Order is dragged or stepped.** The frames drag along the rail
 *   (`useRailReorder`); the ←/→ buttons in this row do the same move for the
 *   keyboard and for touch, where the drag gesture belongs to scrolling.
 *
 * One of three things that may occupy the bottom slot, and never at the same
 * time as another: `LocalityRibbon` enforces that.
 */
export const BilderCarousel = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
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
  //
  // `focusBilde`, not `selectBilde`: this is the surface choosing, and a
  // choice the user did not make must not move the ground under them —
  // pressing `Rediger` while reading a terrain render would otherwise lay the
  // cover image over it.
  const { focusBilde, activeBildeId } = ws;
  useEffect(() => {
    if (!items || items.length === 0 || activeBildeId) return;
    focusBilde(items[0].id);
  }, [items, activeBildeId, focusBilde]);

  // Tombstoned: a `Slett bildet` whose DELETE did not get through, which is
  // the only way an attachment stays on the rail after the confirm now that
  // the deletion is written straight away (§5.6, consequence 2). The frame
  // stays where it was, but every verb that would curate it is gone except
  // the one that takes the deletion back — `Lagre` will retry the DELETE, and
  // curating something on its way out is not a decision anyone needs to make.
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
                {/* The ground verb was here, and is [Bilde]'s pulldown now
                    (§13.10 step 6) — the same deletion the strip took, for the
                    same reason, and the argument that kept it a toggle in edit
                    survives it unchanged: captioning an image against the
                    ground it covers needs the ground, and now nothing about
                    the caption field depends on what is laid down.

                    The sketch's pair stays: the eye that puts the layer up,
                    and the way back under the pen. A sketch is not a [Bilde]
                    member — it is [Skisse]'s — so this is still the card's own
                    switch and still agrees with the row, because both press
                    the same set. */}
                {/* Which funn this image belongs to (§13.6, step 9). First
                    among the verbs because it is the one that decides where
                    the card *sits* — in the exhibit it is a chip on the
                    badges line, and in [Bilde] and [Skisse] it is the heading
                    the layer appears under. Not a map verb either: filing an
                    image changes nothing on the ground. */}
                <BildeFunnPicker ws={ws} rec={active} />
                <SketchToggleButton ws={ws} rec={active} />
                <SketchEditButton ws={ws} rec={active} />
                {/* Not a map verb, which is why it is here and not in the
                    pulldown: it gives the record an extent (§13.5). The
                    switch that uses that extent is [Bilde]'s. */}
                <PlaceUploadButton ws={ws} rec={active} />
                {/* Also not a map verb, and the exception that proves the
                    rule: it does not put *this* record on the ground — a
                    scene is not a layer — it puts the whole row back the way
                    the record says it was (§13.7). */}
                <SceneRestoreButton ws={ws} rec={active} />
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
                  onConfirm={() => void ws.removeBilde(active)}
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
        </div>
      )}
    </div>
  );
};
