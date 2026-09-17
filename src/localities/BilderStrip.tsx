import type { AttachmentRecord } from '../api/attachments';
import {
  BildeBadges,
  BilderRail,
  CaptionField,
  MetaLine,
  OpenOriginalButton,
  SceneRestoreButton,
  SketchToggleButton,
} from './bilderCommon';
import styles from './bilderCommon.module.css';
import type { LocalityWorkspaceApi } from './useLocalityWorkspace';

// What you can do with the image the rail is pointing at, all of it reading.
// The ground verbs belong to [Bilde]'s pulldown; the caption is here but
// read-only, because it is the record's content.
const Detail = ({
  ws,
  rec,
}: {
  ws: LocalityWorkspaceApi;
  rec: AttachmentRecord;
}) => {
  return (
    <div className={styles.detail}>
      <div className={styles.detailMain}>
        <div className={styles.detailHead}>
          <BildeBadges ws={ws} rec={rec} />
          <MetaLine rec={rec} />
        </div>
        <CaptionField ws={ws} rec={rec} />
      </div>

      <div className={styles.actions}>
        {/* In show too: putting a sketch up is reading. `Rediger skissen`
            writes, so it is the carousel's. */}
        <SketchToggleButton ws={ws} rec={rec} />
        {/* Restoring an arrangement is a read as well. */}
        <SceneRestoreButton ws={ws} rec={rec} />
        {/* No `PinRetryButton`: a pin is a write, and this surface is only
            mounted where `canAdd` is false. */}
        <OpenOriginalButton ws={ws} rec={rec} />
      </div>
    </div>
  );
};

/**
 * Show's bottom edge: the shared rail with a read-only line under it. Nothing
 * here writes, and the write verbs are absent rather than disabled — they are
 * in `BilderCarousel`, which takes this slot in edit. One of three occupants
 * of the bottom slot; `LocalityRibbon` keeps them mutually exclusive.
 */
export const BilderStrip = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const items = ws.bilderItems;
  const active = items?.find((it) => it.id === ws.activeBildeId) ?? null;

  return (
    <div className={styles.surface} data-chrome="bottom">
      {/* No `onReorder`: the exhibit order is a write. */}
      <BilderRail ws={ws} />
      {active && <Detail key={active.id} ws={ws} rec={active} />}
    </div>
  );
};
