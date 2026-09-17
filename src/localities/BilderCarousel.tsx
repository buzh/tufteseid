import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmPopover, IconButton, Tooltip } from '../ui';
import {
  BildeBadges,
  BildeFunnPicker,
  BilderRail,
  CaptionField,
  DownloadFigureButton,
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
 * Edit's bottom edge: the same rail show fills, plus the verbs that write.
 * Show's verbs are absent rather than disabled because it is a separate
 * component. One of three occupants of the bottom slot; `LocalityRibbon`
 * keeps them mutually exclusive.
 */
export const BilderCarousel = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const items = ws.bilderItems;
  // The borrowed tail has no position in the exhibit, and `reorderBilde`
  // clamps to that boundary, so counting the whole rail would leave the last
  // `→` enabled on a move it refuses to make.
  const ownCount =
    items?.filter((it) => !ws.inheritedIds.has(it.id)).length ?? 0;
  const index = items?.findIndex((it) => it.id === ws.activeBildeId) ?? -1;
  const active = index >= 0 ? (items?.[index] ?? null) : null;

  // Land on the first image rather than on nothing. `focusBilde`, not
  // `selectBilde`: a choice the user did not make must not lay a bilde over
  // the ground they are reading.
  const { focusBilde, activeBildeId } = ws;
  useEffect(() => {
    if (!items || items.length === 0 || activeBildeId) return;
    focusBilde(items[0].id);
  }, [items, activeBildeId, focusBilde]);

  // Tombstoned: a `Slett bildet` whose DELETE did not get through. Every verb
  // but the undo is gone; `Lagre` retries the DELETE.
  const deleted = active != null && ws.deletedIds.has(active.id);
  // One of the original's Files, on a copy that did not carry it. Every verb
  // but `Ta med` is gone: the record is not in this lokalitet yet.
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
                {/* The full-size file opens straight from the original. */}
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
                {/* Which funn this image belongs to — the heading it appears
                    under in [Bilde] and [Skisse]. Not a map verb. */}
                <BildeFunnPicker ws={ws} rec={active} />
                <SketchToggleButton ws={ws} rec={active} />
                <SketchEditButton ws={ws} rec={active} />
                {/* Gives the record an extent; the switch that uses it is
                    [Bilde]'s. */}
                <PlaceUploadButton ws={ws} rec={active} />
                {/* Puts the whole layer row back the way the scene records
                    it, rather than putting this record on the ground. */}
                <SceneRestoreButton ws={ws} rec={active} />
                <PinRetryButton ws={ws} rec={active} />
                <OpenOriginalButton ws={ws} rec={active} />
                {/* Not offered on a borrowed record: the plate would credit
                    this lokalitet's owner for somebody else's picture. `Ta
                    med` writes the original author onto the copy first. */}
                <DownloadFigureButton ws={ws} rec={active} />

                {/* Position in the exhibit order, for the keyboard and for
                    touch; dragging the frame is the other way. The index is a
                    position in the unfiltered list, which is the same array as
                    `bilderItems` here since edit hides nothing from itself. */}
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
