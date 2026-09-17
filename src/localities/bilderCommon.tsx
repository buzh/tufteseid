// What the two bottom-edge surfaces (show and edit) share: the rail, the
// frames, the detail layout. What they keep to themselves is the row of verbs,
// so no write verb is one boolean away from show.

// Module `t` rather than the hook, because `metaLineOf` and `bildeLabelOf` are
// plain functions and not components. Everything that renders here uses
// `useTranslation`, so a language switch still redraws them.
import { t } from 'i18next';
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
  type AttachmentMeta,
  type AttachmentRecord,
  getAttachmentUrl,
} from '../api/attachments';
import type { LocalityFindRecord } from '../api/localityFinds';
import { dec } from '../figure/draw';
import {
  Badge,
  Button,
  cx,
  Icon,
  IconButton,
  Input,
  type MaterialSymbol,
  Menu,
  Spinner,
  Tooltip,
} from '../ui';
import styles from './bilderCommon.module.css';
import { isDraftId } from './draft';
import { funnIdOf } from './funnGroups';
import { groundExtentOf } from './groundView';
import { type PinState, pinStateOf, subscribePinQueue } from './pinQueue';
import { bilderStripOpenAtom } from './toolAtoms';
import { isBboxAssumed } from './uploadPlacement';
import type { LocalityWorkspaceApi } from './useLocalityWorkspace';
import { type RailReorder, useRailReorder } from './useRailReorder';
import { isPinned } from './viewSpec';

// `landscape` for an extract: the mark the ribbon uses for LiDAR mode, and
// `terrain` is not in the set `material-symbols` ships types for.
export const KIND_ICON: Record<AttachmentKind, MaterialSymbol> = {
  extract: 'landscape',
  screenshot: 'photo_camera',
  upload: 'image',
  flyfoto: 'satellite_alt',
  sketch: 'draw',
  scene: 'layers',
};

// The URL is built on the spot; the file field is not `protected`, so there is
// no token to fetch first. What needs state is the fallback: `thumb` is only a
// request, and PB regularly cannot generate one for the huge stitched extract
// PNGs. Failures are counted rather than flagged — the first is answered by
// asking for the original, the second means the bytes are not coming and the
// frame says so instead of spinning forever.
export const useAttachmentUrl = (
  rec: AttachmentRecord | null,
  thumb?: '200x200' | '800x0',
) => {
  const [failures, setFailures] = useState(0);

  useEffect(() => {
    setFailures(0);
  }, [rec?.id]);

  const error = failures > 1;
  // An unpinned View has no file to point at, and pointing anyway is a 404
  // lighting the error state on a record that is fine. `usePinFace` instead.
  const url =
    rec && isPinned(rec) && !error
      ? getAttachmentUrl(rec, failures === 0 ? thumb : undefined)
      : null;

  return { url, error, onError: () => setFailures((n) => n + 1) };
};

/** What the pin queue is doing about this record right now. */
export const usePinState = (id: string): PinState | undefined =>
  useSyncExternalStore(
    subscribePinQueue,
    () => pinStateOf(id),
    () => undefined,
  );

/**
 * What to draw where the image would be on a View whose pixels do not exist
 * yet; null on a record that has them. Five faces — not written down yet,
 * being made, not asked for, nothing there, went wrong — because only one of
 * them is worth pressing a button about.
 */
export const usePinFace = (
  rec: AttachmentRecord,
): { icon: MaterialSymbol | null; label: string } | null => {
  const { t } = useTranslation();
  const state = usePinState(rec.id);
  if (isPinned(rec)) return null;
  // A View buffered by the open transaction: the server has never heard of it,
  // so the queue can have no opinion and the face says *when*, not what failed.
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
      // Nobody has asked: a reader, or an owner in show. The sweep is on the
      // edit side of the line.
      return { icon: 'image', label: t('localities.bilder.pinAbsent') };
  }
};

/**
 * The face itself. `compact` for the strip's 88×64 frames, where the sentence
 * does not fit and the frame's `title` is carrying it anyway.
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
 * Only a failed render gets a button: `empty` means the source has nothing
 * over this rectangle, so retrying would re-learn the same fact, and `queued`
 * is already happening. Owner-only — a pin is an `update`.
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

// One frame of the rail. Scrolls itself into view when it becomes the active
// one, because the keys walk the rail past its right-hand end. The three
// curation states are marked rather than filtered out, and only edit sees
// them: a concealed image is off the rail in show, a tombstoned one exists
// only inside an open transaction.
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
  /** Tombstoned by this edit session. */
  deleted: boolean;
  /** One of the original's Files, on a copy that did not carry it. */
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

  // One callback ref for two jobs: our own handle for scrollIntoView, and
  // telling the reorder hook where this frame is on screen.
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
          ? // While there are no pixels the pin state is the frame's sentence:
            // the caption describes an image nobody can see yet.
            face.label
          : error
            ? t('localities.bilder.loadFailed')
            : bildeLabelOf(rec)
      }
      onPointerDown={drag ? (e) => drag.onPointerDown(e, rec.id) : undefined}
      onPointerMove={drag?.onPointerMove}
      onPointerUp={drag?.onPointerUp}
      onPointerCancel={drag?.onPointerCancel}
      onClick={() => {
        // The pointerup that ended a drag also produces a click, and landing a
        // card in its new place is not a request to select it.
        if (drag?.consumeClick()) return;
        onClick();
      }}
    >
      {face ? (
        <PinFace rec={rec} compact />
      ) : url ? (
        <img
          src={url}
          alt={bildeLabelOf(rec)}
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
      {/* The cover is derived from the exhibit order, not stored, so this mark
          moves the moment something else is arranged in front of it. */}
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
 * active one ringed. Both stances mount it; `onReorder` is the whole of the
 * stance difference — without it the frames cannot be dragged at all.
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
  // borrowed tail belongs to the original, so it is neither draggable nor a
  // place to drop something.
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
      {/* Above the rail, not a frame in it: the starter set's finished images
          are in the rail, and a placeholder among them reads as one more that
          failed. */}
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

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

// The knobs, per visualization — the switch `terrainSettings` in
// `src/figure/specs.ts` makes, over stored `meta` rather than live state.
// Per visualization rather than "print whatever is in `meta`" because
// `describe()` writes `altitude` and `zFactor` unconditionally, and they mean
// nothing on a sky-view factor: the card would name a sun not in the picture.
// The constants are deliberately absent — VAT's stack, the multidirectional
// azimuths and the SVF direction count are the same on every render ever made,
// so they distinguish nothing and the figure caption is where they are read.
const lightParts = (style: string | null, meta: AttachmentMeta): string[] => {
  const azimuth = num(meta.azimuth);
  const altitude = num(meta.altitude);
  const zFactor = num(meta.zFactor);
  const radius = num(meta.radius);
  const sun = [
    altitude != null ? t('figure.set.altitude', { deg: altitude }) : null,
    zFactor != null ? t('figure.set.zFactor', { z: zFactor }) : null,
  ].filter((s): s is string => !!s);

  switch (style) {
    case 'hillshade':
      return [
        azimuth != null ? t('figure.set.azimuth', { deg: azimuth }) : null,
        ...sun,
      ].filter((s): s is string => !!s);
    case 'multiHillshade':
      return sun;
    case 'slope':
      return zFactor != null ? [t('figure.set.zFactor', { z: zFactor })] : [];
    case 'lrm':
      return radius != null ? [t('figure.set.lrmRadius', { m: radius })] : [];
    case 'svf':
      return radius != null ? [t('figure.set.svfRadius', { m: radius })] : [];
    case 'openPos':
    case 'openNeg':
      return radius != null
        ? [t('figure.set.opennessRadius', { m: radius })]
        : [];
    // VAT's sun is frozen and its stretch absolute, so it has no knobs to
    // name. Everything else here is a WMS style with none either.
    default:
      return [];
  }
};

/**
 * Dataset · style · model · light · resolution, as one line.
 *
 * A function rather than only a component because the layer row's pulldowns
 * print the same line under the same record, and a second reading of `meta`
 * would be a second chance for the two to disagree about what an image is.
 * The light is part of it: eight terrain renders of one rectangle differ in
 * nothing but azimuth, sun altitude and z-factor, so a line stopping at
 * "dataset · style" makes the rail eight identical cards. The parameter
 * strings are `figure.*` rather than re-translated, so this line and the
 * caption burned into the figure cannot word the same record differently.
 */
export const metaLineOf = (rec: AttachmentRecord): string | null => {
  const meta: AttachmentMeta = rec.meta ?? {};
  const style = typeof meta.style === 'string' ? meta.style : null;
  const metresPerPx = num(meta.metresPerPx);

  const parts = [
    typeof meta.sourceLabel === 'string' ? meta.sourceLabel : null,
    // A terrain render's style is a visualization key with a name in three
    // languages; a LiDAR extract's is the WMS layer's own (`skyggerelieff`).
    // One lookup with a default covers both — the vocabularies do not collide.
    style
      ? t(`localities.terrain.vis.${style}`, { defaultValue: style })
      : null,
    typeof meta.model === 'string'
      ? t('figure.set.model', { model: meta.model.toUpperCase() })
      : null,
    ...lightParts(style, meta),
    // `dec`, not the raw number: `metresPerPx` is a division and prints as
    // 0.5001568426393691 if you let it.
    metresPerPx != null
      ? t('localities.bilder.mpp', { m: dec(metresPerPx, 2) })
      : null,
  ].filter((s): s is string => !!s);
  return parts.length > 0 ? parts.join(' · ') : null;
};

/**
 * What to call a bilde in one line: the author's caption, else the provenance
 * line, else the kind — translated, never the bare `rec.kind` string.
 */
export const bildeLabelOf = (rec: AttachmentRecord): string =>
  rec.caption.trim() ||
  metaLineOf(rec) ||
  t(`localities.bilder.kind.${rec.kind}`);

export const MetaLine = ({ rec }: { rec: AttachmentRecord }) => {
  const line = metaLineOf(rec);
  if (!line) return null;
  // `title` because the line truncates, and the azimuth is at the far end.
  return (
    <p className={styles.metaLine} title={line}>
      {line}
    </p>
  );
};

// The funn a bilde belongs to — null for the lokalitet's own images and for
// one whose funn has since been deleted (the relation does not cascade).
const funnOf = (
  ws: LocalityWorkspaceApi,
  rec: AttachmentRecord,
): LocalityFindRecord | null => {
  const finds = ws.findItems ?? [];
  const id = funnIdOf(rec, new Set(finds.map((f) => f.id)));
  return id ? (finds.find((f) => f.id === id) ?? null) : null;
};

// `Hører til` — which funn this bilde belongs to. A menu of one answer, though
// the column stays a multiple relation: `setBildeFunn` writes an array of at
// most one. Edit only, and absent on a lokalitet with no funn. Buffered like
// the caption, so a batch filed and regretted costs `Avbryt` and no writes; a
// funn invented in the same session is offered with its temp id and translated
// at the commit (`useLocalityDraft`).
export const BildeFunnPicker = ({
  ws,
  rec,
}: {
  ws: LocalityWorkspaceApi;
  rec: AttachmentRecord;
}) => {
  const { t } = useTranslation();
  const finds = ws.findItems ?? [];
  if (!ws.canEdit || finds.length === 0) return null;
  const current = funnOf(ws, rec);
  const titleOf = (f: LocalityFindRecord) =>
    f.title.trim() || t('localities.funn.untitled');

  return (
    <Menu
      align="end"
      width={230}
      label={t('localities.funn.belongsTo')}
      title={t('localities.funn.belongsTo')}
      trigger={(p) => (
        <Button
          size="sm"
          palette="gray"
          leftIcon="bookmark"
          rightIcon="keyboard_arrow_down"
          title={t('localities.funn.belongsHint')}
          aria-expanded={p.open}
          onClick={p.onClick}
        >
          {current ? titleOf(current) : t('localities.funn.none')}
        </Button>
      )}
      items={[
        {
          label: t('localities.funn.none'),
          active: current == null,
          onSelect: () => {
            if (current) ws.setBildeFunn(rec, null);
          },
        },
        // The tombstoned ones are out: a relation to a funn this session has
        // deleted is dropped at the commit, so offering it does nothing.
        ...finds
          .filter((f) => !ws.deletedIds.has(f.id))
          .map((f) => ({
            label: titleOf(f),
            active: current?.id === f.id,
            onSelect: () => {
              if (current?.id !== f.id) ws.setBildeFunn(rec, f.id);
            },
          })),
      ]}
    />
  );
};

/** Kind, cover and concealment, said as chips. */
export const BildeBadges = ({
  ws,
  rec,
  borrowed,
}: {
  ws: LocalityWorkspaceApi;
  rec: AttachmentRecord;
  /** One of the original's Files, on a copy that did not carry it. */
  borrowed?: boolean;
}) => {
  const { t } = useTranslation();
  const funn = funnOf(ws, rec);
  const funnLabel = funn
    ? t('localities.funn.badge', {
        title: funn.title.trim() || t('localities.funn.untitled'),
      })
    : null;
  return (
    <>
      <Badge>{t(`localities.bilder.kind.${rec.kind}`)}</Badge>
      {/* A borrowed image is not part of this exhibit yet, so neither the
          cover nor the hidden mark would mean anything on it. */}
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
          {/* An assumed extent is said in both stances and on both surfaces:
              the [Bilde] row carries the same sentence as a `note`. */}
          {isBboxAssumed(rec) && (
            <Badge palette="gray">{t('localities.bilder.assumed')}</Badge>
          )}
          {/* The filing, in both stances — the picker beside it is edit's.
              A dangling id shows nothing: `funnIdOf` answers null for it. */}
          {funnLabel && <Badge palette="gray">{funnLabel}</Badge>}
        </>
      )}
    </>
  );
};

// `Plasser i ruta` — the upload opt-in. It gives a record an extent, which is
// an edit like a caption; the switch that lays it on the map is [Bilde]'s, and
// appears there once this has been pressed. Uploads only: every other kind
// already knows where it is. `canEdit` rather than `canAdd`, because this is
// an update and an admin may make it. Not optimistic — reading the file's
// aspect is a fetch and a decode, so the button spins until the buffer has the
// rectangle.
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

  // The placement is exactly `meta.bbox25833` — the same question [Bilde] asks
  // to decide whether the record is a member at all.
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

// `Legg ut igjen` — put a kept arrangement back on the map. A scene has no
// switch anywhere, because it is not a layer (`groundView.ts` refuses to put
// one on the ground), so this is its one verb. A read, so both stances and
// every access level get it: applying an arrangement to your own screen
// writes nothing.
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

// The caption. `readOnly` rather than absent in show, because a caption is the
// record's content and hiding it would hide what the exhibit says. Local state
// committed on blur, so a realtime reload mid-sentence cannot rewrite the
// field under the cursor.
export const CaptionField = ({
  ws,
  rec,
  readOnly,
}: {
  ws: LocalityWorkspaceApi;
  rec: AttachmentRecord;
  /**
   * Forced on for a borrowed card: the record belongs to the original, so a
   * caption typed here would land in this session's buffer under an id
   * `Lagre` would then PATCH on their behalf. `Ta med` first.
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

// A sketch's own eye. Presses the same set [Skisse] does, so the card and the
// layer row cannot disagree. Present in show as well as edit — turning a layer
// on writes nothing.
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
 * The sketch's scene under the pen again. Owner-gated, because `Behold
 * skissen` at the other end is an update; buffered until then, so a re-draw
 * abandoned with `Avbryt` costs the record nothing. `resumeSketch` refuses a
 * sketch whose spec cannot be read back rather than opening an empty canvas.
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

// The full-size file in a tab of its own, and one of the two places that force
// a pin: there is nothing to open on an unpinned View. Two presses, because
// `window.open` seconds after the click that caused it is a popup and gets
// blocked — the button renders on the first press and opens inside the gesture
// of the second. Owner-gated, because a pin writes.
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
  // than on the realtime event bringing the list round again.
  const [pinnedRec, setPinnedRec] = useState<AttachmentRecord | null>(null);
  const target = isPinned(rec) ? rec : pinnedRec;

  if (!target) {
    // Nothing to force a pin against while the spec is only in the draft:
    // there is no record id the queue could PATCH. `Lagre` writes it and the
    // queue picks it up.
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
        window.open(getAttachmentUrl(target), '_blank', 'noopener');
      }}
    >
      {t('localities.bilder.openOriginal')}
    </Button>
  );
};
