/*
 * The parts the two bottom-edge surfaces share (docs/lokalitet-view.md §4.3).
 *
 * Both stances are a rail of the lokalitet's images with a line about the
 * active one under it — the same geometry, because arranging a set needs to
 * see the set, and that is as true of the stance that does the arranging as
 * of the one that only walks it. So the surface, the rail, the frames and the
 * detail layout are all here, and what the two surfaces still own is **the
 * row of verbs**: show's are all reading, edit's include everything that
 * writes. That is the only difference §2 ever asked to be visible, and
 * keeping it in two components is what stops a write verb from being one
 * boolean away from show.
 *
 * The token dance that fetches an image, the line naming the dataset and the
 * caption field are shared for the older reason: two copies of
 * `useAttachmentUrl` would be two chances to get the protected-file fallback
 * wrong.
 */

import { useSetAtom } from 'jotai';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  type AttachmentKind,
  type AttachmentRecord,
  getAttachmentUrl,
} from '../api/attachments';
import {
  Badge,
  Button,
  cx,
  Icon,
  IconButton,
  Input,
  type MaterialSymbol,
  Spinner,
  Tooltip,
} from '../ui';
import styles from './bilderCommon.module.css';
import { isDraftId } from './draft';
import { groundExtentOf } from './groundView';
import { type PinState, pinStateOf, subscribePinQueue } from './pinQueue';
import { bilderStripOpenAtom } from './toolAtoms';
import { isBboxAssumed } from './uploadPlacement';
import type { LocalityWorkspaceApi } from './useLocalityWorkspace';
import { type RailReorder, useRailReorder } from './useRailReorder';
import { isPinned } from './viewSpec';

// `landscape` is what the ribbon already uses for LiDAR mode, so an
// extract carries the same mark here. (Material Symbols' `terrain` isn't
// in the set material-symbols ships types for.)
export const KIND_ICON: Record<AttachmentKind, MaterialSymbol> = {
  extract: 'landscape',
  screenshot: 'photo_camera',
  upload: 'image',
  flyfoto: 'satellite_alt',
  sketch: 'draw',
  // The same mark the layer row's own button would wear: a scene is the row,
  // kept (§13.7).
  scene: 'layers',
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

/*
 * One frame of the rail.
 *
 * Scrolls itself into view when it becomes the active one, because ←/→ walk
 * the rail and the twelfth image is off the right-hand end of it — a keyboard
 * step that changes the surface but not the rail would leave you unable to see
 * what you are looking at.
 *
 * The three curation states are marked here rather than being filtered out,
 * and only edit ever sees them: a concealed image is not on the rail in show
 * at all, and a tombstoned one exists only inside an open transaction.
 */
const Frame = ({
  rec,
  selected,
  isCover,
  deleted,
  borrowed,
  drag,
  insertSide,
  onClick,
}: {
  rec: AttachmentRecord;
  selected: boolean;
  isCover: boolean;
  /** Tombstoned by this edit session (§5.6, consequence 2). */
  deleted: boolean;
  /** One of the original's Files, on a copy that did not carry it (§7). */
  borrowed: boolean;
  /** Null in show — nothing there reorders anything. */
  drag: RailReorder | null;
  insertSide: 'left' | 'right' | null;
  onClick: () => void;
}) => {
  const { url, error, onError } = useAttachmentUrl(rec, '200x200');
  const face = usePinFace(rec);
  const { t } = useTranslation();
  const el = useRef<HTMLButtonElement | null>(null);

  // One callback ref for two jobs: keeping our own handle for scrollIntoView,
  // and telling the reorder hook where this frame is on screen.
  const register = drag?.register;
  const setRef = useCallback(
    (node: HTMLButtonElement | null) => {
      el.current = node;
      register?.(rec.id, node);
    },
    [register, rec.id],
  );

  useEffect(() => {
    if (!selected) return;
    el.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    });
  }, [selected]);

  return (
    <button
      ref={setRef}
      type="button"
      className={cx(
        styles.frame,
        selected && styles.frameOn,
        rec.hidden && !borrowed && styles.frameHidden,
        deleted && styles.frameDeleted,
        borrowed && styles.frameBorrowed,
        drag?.dragId === rec.id && styles.frameDragging,
      )}
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
      onPointerDown={drag ? (e) => drag.onPointerDown(e, rec.id) : undefined}
      onPointerMove={drag?.onPointerMove}
      onPointerUp={drag?.onPointerUp}
      onPointerCancel={drag?.onPointerCancel}
      onClick={() => {
        // The pointerup that ended a drag also produces a click, and landing
        // a card in its new place is not a request to select it.
        if (drag?.consumeClick()) return;
        onClick();
      }}
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
      {isCover && !borrowed && (
        <span className={cx(styles.mark, styles.coverMark)}>
          <Icon icon="star" size={13} filled />
        </span>
      )}
      {rec.hidden && !borrowed && (
        <span className={cx(styles.mark, styles.hiddenMark)}>
          <Icon icon="hide_image" size={13} />
        </span>
      )}
      {insertSide && (
        <span className={styles.insertMark} data-side={insertSide} />
      )}
    </button>
  );
};

/**
 * The rail: every image this lokalitet holds, in exhibit order, with the
 * active one ringed. Both stances mount it, and the ground does not move as
 * you walk it — so stepping the rail is flipping between readings of one
 * rectangle in register, which is the curtain's trick and the flyfoto temporal
 * stack's trick applied to the images somebody already decided were worth
 * keeping.
 *
 * `onReorder` is the whole of the stance difference here: with it the frames
 * can be dragged into a new exhibit position, without it they cannot be
 * dragged at all (§2, `useRailReorder`).
 */
export const BilderRail = ({
  ws,
  onReorder,
}: {
  ws: LocalityWorkspaceApi;
  onReorder?: (id: string, toIndex: number) => void;
}) => {
  const { t } = useTranslation();
  const setOpen = useSetAtom(bilderStripOpenAtom);
  const railRef = useRef<HTMLDivElement | null>(null);
  const items = ws.bilderItems;
  const walkable = (items?.length ?? 0) > 1;

  // Only this lokalitet's own images have a position in its exhibit; the
  // borrowed tail (§7) is a suffix that belongs to the original, so it is
  // neither draggable nor a place to drop something.
  const { inheritedIds } = ws;
  const ownIds = useMemo(
    () =>
      (items ?? [])
        .filter((rec) => !inheritedIds.has(rec.id))
        .map((rec) => rec.id),
    [items, inheritedIds],
  );

  const drag = useRailReorder(ownIds, railRef, onReorder ?? null);

  // Which frame wears the insertion mark, and on which side. The gap index is
  // in the list without the dragged frame, so the mark goes on the frame that
  // would follow it — or on the trailing edge of the last one.
  let markId: string | null = null;
  let markSide: 'left' | 'right' = 'left';
  if (drag.dragId != null && drag.insertAt != null) {
    const rest = ownIds.filter((id) => id !== drag.dragId);
    if (rest.length > 0) {
      if (drag.insertAt < rest.length) {
        markId = rest[drag.insertAt];
      } else {
        markId = rest[rest.length - 1];
        markSide = 'right';
      }
    }
  }

  return (
    <>
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

        <div
          ref={railRef}
          className={cx(styles.rail, drag.dragId && styles.railDragging)}
        >
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
                deleted={ws.deletedIds.has(rec.id)}
                borrowed={inheritedIds.has(rec.id)}
                drag={
                  onReorder != null && !inheritedIds.has(rec.id) ? drag : null
                }
                insertSide={rec.id === markId ? markSide : null}
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
    </>
  );
};

/**
 * Dataset · style · resolution, as one line — the record's provenance in the
 * smallest space it fits in.
 *
 * A function rather than only a component because [Visning]'s pulldown prints
 * the same line under the same record (§13.4, where the row's label *is* the
 * provenance), and a second reading of `meta` would be a second chance for the
 * card and the layer row to disagree about what an image is.
 */
export const metaLineOf = (rec: AttachmentRecord): string | null => {
  const meta = rec.meta ?? {};
  const parts = [
    typeof meta.sourceLabel === 'string' ? meta.sourceLabel : null,
    typeof meta.style === 'string' ? meta.style : null,
    typeof meta.metresPerPx === 'number' ? `${meta.metresPerPx} m/px` : null,
  ].filter((s): s is string => !!s);
  return parts.length > 0 ? parts.join(' · ') : null;
};

export const MetaLine = ({ rec }: { rec: AttachmentRecord }) => {
  const line = metaLineOf(rec);
  if (!line) return null;
  return <p className={styles.metaLine}>{line}</p>;
};

/** Kind, cover and concealment, said as chips. */
export const BildeBadges = ({
  ws,
  rec,
  borrowed,
}: {
  ws: LocalityWorkspaceApi;
  rec: AttachmentRecord;
  /** One of the original's Files, on a copy that did not carry it (§7). */
  borrowed?: boolean;
}) => {
  const { t } = useTranslation();
  return (
    <>
      <Badge>{t(`localities.bilder.kind.${rec.kind}`)}</Badge>
      {/* Said first among the states, because it is the one that changes what
          the card *is*: a borrowed image is not part of this exhibit yet, so
          neither the cover nor the hidden mark would mean anything on it. */}
      {borrowed ? (
        <Badge palette="blue">{t('localities.copy.borrowed')}</Badge>
      ) : (
        <>
          {ws.coverBildeId === rec.id && (
            <Badge palette="blue">{t('localities.bilder.cover')}</Badge>
          )}
          {rec.hidden && (
            <Badge palette="yellow">{t('localities.bilder.hidden')}</Badge>
          )}
          {/* Said in both stances and on both surfaces, because §13.5's rule
              is that the assumption must not be lost when it leaves the
              surface that made it. The [Bilde] row carries the same sentence
              as a `note`; this is the card's copy of it. */}
          {isBboxAssumed(rec) && (
            <Badge palette="gray">{t('localities.bilder.assumed')}</Badge>
          )}
        </>
      )}
    </>
  );
};

/*
 * `Plasser i ruta` — the upload opt-in (§13.5, §13.10 step 7).
 *
 * The one verb on a card that is about the map, and it survives the rule that
 * deleted the others because it is not a map verb. `Vis i ruta` *showed* an
 * image; this one gives a record an extent, which is an edit of the same kind
 * as a caption or a concealment and stays where those are. The switch that
 * actually lays it down is [Bilde]'s, where every other File's is, and it
 * appears there the moment this has been pressed.
 *
 * Uploads only: every other kind already knows where it is, and offering to
 * invent a rectangle for an extract that was cut to one would be offering to
 * make it worse. Edit only, and `canEdit` rather than `canAdd` — this is an
 * update, so an admin over somebody else's lokalitet may do it.
 *
 * Nothing about the press is optimistic: reading the file's aspect is a fetch
 * and a decode, so the button spins until the buffer has the rectangle.
 */
export const PlaceUploadButton = ({
  ws,
  rec,
}: {
  ws: LocalityWorkspaceApi;
  rec: AttachmentRecord;
}) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (rec.kind !== 'upload' || !ws.canEdit) return null;

  // The placement is exactly `meta.bbox25833`, so this is the same question
  // [Bilde] asks to decide whether the record is a member at all.
  if (groundExtentOf(rec.meta ?? {}) != null) {
    return (
      <Button
        size="sm"
        palette="gray"
        leftIcon="wrong_location"
        title={t('localities.bilder.unplaceHint')}
        onClick={() => ws.unplaceUpload(rec)}
      >
        {t('localities.bilder.unplace')}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      leftIcon="pin_drop"
      disabled={busy}
      title={t('localities.bilder.placeHint')}
      onClick={() => {
        setBusy(true);
        void ws.placeUpload(rec).finally(() => setBusy(false));
      }}
    >
      {t('localities.bilder.place')}
    </Button>
  );
};

/*
 * `Legg ut igjen` — put a kept arrangement back on the map (§13.7).
 *
 * The other half of `Oppsett` on the row, and on the card rather than in the
 * layer row for the mirror of that button's reason: the row is where an
 * arrangement is *made*, and a record that replaces the whole row's state is a
 * thing you pick out of the exhibit, not a member of it. A scene has no switch
 * anywhere — it is not a layer (`groundView.ts` refuses to put one on the
 * ground) — so this is its one verb.
 *
 * A read, so both stances and every access level get it. That is the same rule
 * `Gjenskap` follows one level down (§13.8): applying somebody's arrangement to
 * your own screen writes nothing anywhere.
 */
export const SceneRestoreButton = ({
  ws,
  rec,
}: {
  ws: LocalityWorkspaceApi;
  rec: AttachmentRecord;
}) => {
  const { t } = useTranslation();
  if (rec.kind !== 'scene') return null;
  return (
    <Button
      size="sm"
      palette="gray"
      leftIcon="settings_backup_restore"
      title={t('localities.scene.restoreHint')}
      onClick={() => ws.restoreScene(rec)}
    >
      {t('localities.scene.restore')}
    </Button>
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
  readOnly,
}: {
  ws: LocalityWorkspaceApi;
  rec: AttachmentRecord;
  /**
   * Forced on for a borrowed card (§7). The record belongs to the original,
   * so a caption typed here would either edit somebody else's lokalitet or —
   * worse — go into this session's buffer under an id `Lagre` would then
   * PATCH on their behalf. `Ta med` first; then it is yours to caption.
   */
  readOnly?: boolean;
}) => {
  const { t } = useTranslation();
  const [caption, setCaption] = useState(rec.caption ?? '');

  useEffect(() => {
    setCaption(rec.caption ?? '');
  }, [rec.id, rec.caption]);

  return (
    <Input
      value={caption}
      readOnly={readOnly || !ws.canEdit}
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

/*
 * A sketch's own eye — the last card verb that is about the map.
 *
 * It outlived `Vis i ruta`, which was the same idea done worse: that one held
 * a single image on a ground that could only hold one, while a sketch has
 * always been a *set* — two readings of the same mound can both be up, and
 * either can come off without disturbing the other (§9.3). Step 6 made the
 * Files work the way the sketches already did, and moved their switch to the
 * row; this one stays on the card because it presses the same set [Skisse]
 * does, so the two surfaces cannot disagree.
 *
 * Present in show as well as edit: turning a layer on writes nothing, and
 * comparing the drawings against the image they were made over is the whole
 * reason they are stored as overlays rather than flattened into one.
 */
export const SketchToggleButton = ({
  ws,
  rec,
}: {
  ws: LocalityWorkspaceApi;
  rec: AttachmentRecord;
}) => {
  const { t } = useTranslation();
  if (rec.kind !== 'sketch') return null;
  const shown = ws.sketchShown.has(rec.id);
  return (
    <Button
      size="sm"
      leftIcon={shown ? 'visibility_off' : 'visibility'}
      title={t('localities.sketch.showHint')}
      onClick={() => ws.toggleSketch(rec.id)}
    >
      {shown ? t('localities.sketch.hide') : t('localities.sketch.show')}
    </Button>
  );
};

/**
 * …and the way back into it: the scene, under the pen again.
 *
 * The one entrance a sketch has that no other bilde does, and the mirror of
 * `Rediger tegningen` on a funn. Owner-gated, because `Behold skissen` at the
 * other end of it is an update; buffered until then, so a re-draw you abandon
 * with `Avbryt` costs the record nothing.
 *
 * Absent on a sketch whose spec cannot be read back — `resumeSketch` says so
 * rather than opening an empty canvas over the drawing it failed to load.
 */
export const SketchEditButton = ({
  ws,
  rec,
}: {
  ws: LocalityWorkspaceApi;
  rec: AttachmentRecord;
}) => {
  const { t } = useTranslation();
  if (rec.kind !== 'sketch' || !ws.canAdd) return null;
  return (
    <Button
      size="sm"
      leftIcon="draw"
      title={t('localities.sketch.editHint')}
      onClick={() => ws.resumeSketch(rec)}
    >
      {t('localities.sketch.edit')}
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
