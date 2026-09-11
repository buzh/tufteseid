import { useTranslation } from 'react-i18next';
import type { AttachmentRecord } from '../api/attachments';
import { Button } from '../ui';
import {
  BildeBadges,
  BilderRail,
  CaptionField,
  FadeControl,
  MetaLine,
  Note,
  OpenOriginalButton,
  RecreateButton,
} from './bilderCommon';
import styles from './bilderCommon.module.css';
import type { LocalityWorkspaceApi } from './useLocalityWorkspace';
import { canPinBilde } from './usePinnedBilde';

/*
 * What you can do with the image the rail is pointing at, and it is all
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
 * The shared rail (`BilderRail`) with a read-only line under it. It replaced
 * the dock's Bilder section, and the shape changed with the edge: a grid of
 * squares down a column reads as an inventory, a rail along the bottom reads
 * as a sequence.
 *
 * **Nothing here writes.** Not "is disabled" — is absent: the concealed images
 * are not on the rail, there is no delete, no reordering and no hide, and the
 * caption is read-only. Every one of those is in the carousel that takes this
 * slot in edit (BilderCarousel), which is what §2 means by the stance being
 * legible from across the room. The two are the same geometry on purpose —
 * the verbs are what you read the stance off, not the layout.
 *
 * This is one of three things that may occupy the bottom slot, and never at
 * the same time as another: `LocalityRibbon` is where that rule is enforced.
 */
export const BilderStrip = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const items = ws.bilderItems;
  const active = items?.find((it) => it.id === ws.activeBildeId) ?? null;

  return (
    <div className={styles.surface} data-chrome="bottom">
      {/* No `onReorder`: the exhibit order is a thing about the record, so
          changing it is a write and belongs to the other stance. */}
      <BilderRail ws={ws} />
      {active && <Detail key={active.id} ws={ws} rec={active} />}
    </div>
  );
};
