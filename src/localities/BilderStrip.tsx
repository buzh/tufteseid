import type { AttachmentRecord } from '../api/attachments';
import {
  BildeBadges,
  BilderRail,
  CaptionField,
  MetaLine,
  OpenOriginalButton,
  SketchToggleButton,
} from './bilderCommon';
import styles from './bilderCommon.module.css';
import type { LocalityWorkspaceApi } from './useLocalityWorkspace';

/*
 * What you can do with the image the rail is pointing at, and it is all
 * reading: the sketch's own eye and the original.
 *
 * **The ground verbs are gone from here** (§13.10 step 6). `Vis i ruta` /
 * `Ta av ruta` put one File on the map and `Transparens` faded it from the
 * rectangle's corner; both are [Bilde]'s pulldown now, with a switch and a
 * fade per File and several down at once. What that removes from this surface
 * is a set of controls that were about the *map* on a rail that is about the
 * *exhibit* — and with them the failure note, which moved onto the switch
 * that is claiming the layer is up (`LayerMember.warning`).
 *
 * The caption stays, `readOnly` rather than absent, because a caption is the
 * record's content and hiding what the exhibit says would be a strange way to
 * show it (§8.1).
 */
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
        {/* And here in show as well, because turning a layer on is reading:
            a sketch is only worth storing separately from its ground if it
            can be held up against it and taken away again. `Rediger skissen`
            is the carousel's — that one writes. */}
        <SketchToggleButton ws={ws} rec={rec} />
        {/* No retry here, and none is reachable: a pin is a write, so
            `PinRetryButton` is the carousel's. This surface is only ever
            mounted where `canAdd` is false. */}
        <OpenOriginalButton ws={ws} rec={rec} />
      </div>
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
 * are not on the rail, there is no delete, no reordering and no
 * hide-from-exhibit, and the caption is read-only. Every one of those is in the carousel that takes this
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
