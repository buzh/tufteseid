import type { FeatureCollection } from 'geojson';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AttachmentRecord,
  createAttachment,
  createAttachmentSpec,
  deleteAttachment,
  getAttachmentUrl,
} from '../api/attachments';
import {
  deleteLocality,
  getLocality,
  LocalityBbox,
  LocalityPatch,
  LocalityRecord,
} from '../api/localities';
import { LocalityFindRecord, LocalityFindStatus } from '../api/localityFinds';
import { currentUserAtom, isAdminAtom } from '../auth/atoms';
import {
  SCENE_BUDGET_BYTES,
  sceneBytes,
  sketchSceneOf,
  storableScene,
  type SketchScene,
} from '../funn/scene';
import {
  drawRequestedAtom,
  funnSceneAtom,
  funnSessionAtom,
  sceneNow,
} from '../funn/session';
import {
  setSketchOverlays,
  sketchGroupShownAtom,
  sketchOpacityAtom,
  sketchShownAtom,
  type SketchOverlay,
} from '../map/sketchOverlay';
import { renderFigureBlob } from '../figure/figure';
import { describeHeritageRender, screenshotFigure } from '../figure/specs';
import type { LidarSource } from '../lidarExtract/sources';
import { mapAtom } from '../map/atoms';
import {
  bildeGroupShownAtom,
  bildeOpacityAtom,
  bildeShownAtom,
  provisionalViewAtom,
  visningGroupShownAtom,
  visningOpacityAtom,
  visningShownAtom,
} from '../map/groundOverlay';
import { shownThemeLayersAtom } from '../map/layers/atoms';
import {
  heritageDetailsAtom,
  heritageOpacityAtom,
  heritageRenderAtom,
} from '../map/layers/heritage';
import { leaveCompareAtom } from '../map/compare/atoms';
import { compareOnAtom } from '../map/compare/halves';
import type { BackgroundLayerName } from '../map/layers/backgroundLayers';
import {
  backgroundLayerHalves,
  hybridOverlayHalves,
} from '../map/layers/config/backgroundLayers/atoms';
import { fitPadding, FUNN_MARGIN_PX } from '../shell/chromeInsets';
import { recreateViewAtom } from '../shell/useRecreateView';
import { selectVisningAtom } from '../shell/visningRing';
import { toast } from '../ui';
import {
  activeLocalityAtom,
  adjustingLocalityAtom,
  coverTerrainSpecAtom,
  editingLocalityIdAtom,
  funnDraftActiveAtom,
  funnHiddenAtom,
  funnSwitchedOffAtom,
  pendingStarterLocalityIdAtom,
  selectedFunnIdAtom,
} from './atoms';
import { bboxExceedsMax, MAX_SIDE_M } from './bboxLimits';
import {
  attachmentMatchesKey,
  type BeholdKey,
  beholdOfferAtom,
  flyfotoSpecMeta,
  lidarSpecMeta,
  NIB_MOSAIC_KEY,
} from './behold';
import { bilderRingAtom } from './bilderRing';
import { copyLocality, type CopyProgress } from './copyLocality';
import {
  attachmentBaseOf,
  clearDraft,
  type DraftFind,
  type DraftLocality,
  type DraftSpec,
  draftCounts,
  dropAttachment,
  dropFind,
  findBaseOf,
  forgetAttachment,
  isDirty,
  isDraftId,
  mintDraftId,
  overlayAttachments,
  overlayFinds,
  undelete,
  withAttachment,
  withEager,
  withFind,
  withLocality,
  withNewFind,
  withNewSpec,
} from './draft';
import {
  fetchFlyfotoProjectsForBbox,
  type FlyfotoProject,
} from './flyfotoProjects';
import { orderedByFunn } from './funnGroups';
import {
  getFunnExtentOnLayer,
  hideFunnOnLayer,
  refreshFunnLayer,
  removeFunnFromLayer,
  upsertFunnOnLayer,
} from './funnLayer';
import { groundExtentOf } from './groundView';
import {
  removeLocalityFromLayer,
  setLocalityHighlight,
  upsertLocalityOnLayer,
} from './localityLayer';
import { enqueuePin, pinAttempted, pinNow, type Produced } from './pinQueue';
import {
  sceneCompositionOf,
  sceneGroundOf,
  type SceneLayer,
  sceneMetaOf,
} from './sceneSpec';
import { captureLocalityScreenshot } from './screenshot';
import { planStarterPack } from './starterPack';
import { buildTakeout, type TakeoutProgress } from './takeout';
import {
  bilderStripOpenAtom,
  funnOutsideAtom,
  ribbonToolAtom,
  workspaceModeAtom,
} from './toolAtoms';
import { assumedExtentOf, imageAspectOf } from './uploadPlacement';
import { useFunnAutosave } from './useFunnAutosave';
import { useInheritedBilder } from './useInheritedBilder';
import { useLocalityAdjust } from './useLocalityAdjust';
import { useLocalityAttachments, useLocalityFinds } from './useLocalityContent';
import { useLocalityDraft } from './useLocalityDraft';
import { type PickerCandidate, usePickerRun } from './usePickerRun';
import { useWorkspaceKeys } from './useWorkspaceKeys';
import { isPinned, viewSpecOf } from './viewSpec';

/** PocketBase lets an admin change and delete anybody's records but not add
 *  content to them, hence three values rather than a boolean. */
export type LocalityAccess = 'owner' | 'admin' | 'reader';

/** Orthogonal to `LocalityAccess`: access is a fact about the record, stance
 *  is a choice made inside it. */
export type Stance = 'show' | 'edit';

// Caps how many acquisitions one picker run offers for judging; a busy area
// lists well over a hundred.
export const FLYFOTO_BATCH_MAX = 8;

// Spacing between exhibit positions on a full renumber: room for ten further
// moves by halving, yet far below the epoch-millisecond keys
// `nextAttachmentSort` mints, which keeps a new bilde at the end.
const SORT_STEP = 1000;

// What the ground was, for the screenshot figure's source line.
const GROUND_LABEL_KEY: Record<BackgroundLayerName, string> = {
  // The five Standard cartographies name themselves rather than all reporting
  // "Standard"; the caption is the only place the file says which it is.
  topo: 'ribbon.standard.topo',
  topograatone: 'ribbon.standard.topograatone',
  toporaster: 'ribbon.standard.toporaster',
  sjokartraster: 'ribbon.standard.sjokartraster',
  amtskart: 'ribbon.standard.amtskart',
  empty: 'ribbon.mode.standard',
  lidarHillshade: 'ribbon.mode.lidar',
  lidarProject: 'ribbon.mode.lidar',
  flyfoto: 'ribbon.mode.flyfoto',
  flyfotoProject: 'ribbon.mode.flyfoto',
  // Never the value of the background atom (hybrid is a modifier), but the
  // union has to be covered.
  topoOverlay: 'ribbon.mode.hybrid',
};

// Hybrid is a LiDAR stack with names on it: same credit, different label.
const groundLabelKey = (layer: BackgroundLayerName, hybrid: boolean): string =>
  hybrid ? 'ribbon.mode.hybrid' : GROUND_LABEL_KEY[layer];

// Grounds whose credit line has to name NiB as well as Kartverket.
const NIB_GROUNDS = new Set<BackgroundLayerName>(['flyfoto', 'flyfotoProject']);

const bboxContains = (outer: LocalityBbox, inner: LocalityBbox): boolean =>
  inner[0] >= outer[0] &&
  inner[1] >= outer[1] &&
  inner[2] <= outer[2] &&
  inner[3] <= outer[3];

const bboxUnion = (a: LocalityBbox, b: LocalityBbox): LocalityBbox => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
];

/**
 * Everything the lokalitet workspace does, minus the rendering.
 *
 * Mount once: `useLocalityFinds` / `useLocalityAttachments` each open a
 * PocketBase realtime subscription that reloads the whole list on every
 * event, so a second call site means N subscriptions and N reloads per change.
 */
export const useLocalityWorkspace = (locality: LocalityRecord) => {
  const { t, i18n } = useTranslation();
  const map = useAtomValue(mapAtom);
  // For values only wanted at the instant of a click (the layer-row fades):
  // subscribing to them would re-render everything this hook feeds per frame.
  const store = useStore();
  const user = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const setActiveLocality = useSetAtom(activeLocalityAtom);
  const [editingId, setEditingId] = useAtom(editingLocalityIdAtom);
  const setCoverTerrainSpec = useSetAtom(coverTerrainSpecAtom);
  // The pen: the request is written here, the session and scene are the
  // surface's answer, and everything below reads those rather than a flag.
  const setDrawRequested = useSetAtom(drawRequestedAtom);
  const drawSession = useAtomValue(funnSessionAtom);
  const scene = useAtomValue(funnSceneAtom);
  const draftActive = useAtomValue(funnDraftActiveAtom);
  const sketchActive = drawSession?.mode === 'sketch';
  const [sketchShown, setSketchShown] = useAtom(sketchShownAtom);
  const [sketchOpacity, setSketchOpacityMap] = useAtom(sketchOpacityAtom);
  const [sketchGroupShown, setSketchGroupShown] = useAtom(sketchGroupShownAtom);
  // The two ground groups' switches are subscribed to, their fades are not.
  const [visningShown, setVisningShown] = useAtom(visningShownAtom);
  const setVisningOpacity = useSetAtom(visningOpacityAtom);
  const [visningGroupShown, setVisningGroupShown] = useAtom(
    visningGroupShownAtom,
  );
  const setProvisionalView = useSetAtom(provisionalViewAtom);
  const [bildeShown, setBildeShown] = useAtom(bildeShownAtom);
  const setBildeOpacity = useSetAtom(bildeOpacityAtom);
  const [bildeGroupShown, setBildeGroupShown] = useAtom(bildeGroupShownAtom);
  const [adjusting, setAdjusting] = useAtom(adjustingLocalityAtom);
  const [selectedFunnId, setSelectedFunnId] = useAtom(selectedFunnIdAtom);
  const setFunnHidden = useSetAtom(funnHiddenAtom);
  const setFunnSwitchedOff = useSetAtom(funnSwitchedOffAtom);
  const [tool, setTool] = useAtom(ribbonToolAtom);
  const mode = useAtomValue(workspaceModeAtom);
  const stripOpen = useAtomValue(bilderStripOpenAtom);
  const [funnOutside, setFunnOutside] = useAtom(funnOutsideAtom);
  const leaveCompare = useSetAtom(leaveCompareAtom);
  // Read so a screenshot can credit its pixels. Both compare halves, since a
  // split screenshot has two grounds and possibly two rights holders.
  const background = useAtomValue(backgroundLayerHalves.a);
  const hybrid = useAtomValue(hybridOverlayHalves.a);
  const compareOn = useAtomValue(compareOnAtom);
  const backgroundB = useAtomValue(backgroundLayerHalves.b);
  const hybridB = useAtomValue(hybridOverlayHalves.b);
  // What the heritage overlay is drawing, not what is ticked: the figure
  // caption names what is in the pixels.
  const themeLayers = useAtomValue(shownThemeLayersAtom);
  const heritageDetails = useAtomValue(heritageDetailsAtom);
  const heritageRender = useAtomValue(heritageRenderAtom);
  const heritageOpacity = useAtomValue(heritageOpacityAtom);
  const [shooting, setShooting] = useState(false);
  const [uploading, setUploading] = useState(false);
  // An id, not a flag, so the spinner lands on the pressed card.
  const [takingId, setTakingId] = useState<string | null>(null);
  const [copyPrompt, setCopyPrompt] = useState(false);
  const [copyProgress, setCopyProgress] = useState<CopyProgress | null>(null);
  const [takeoutProgress, setTakeoutProgress] =
    useState<TakeoutProgress | null>(null);
  // Whether the NiB licensing notice is up, and what accepting it does: two
  // routes reach NiB and consent is owed on both.
  const [flyfotoNotice, setFlyfotoNotice] = useState<
    'picker' | 'behold' | null
  >(null);
  const [starterBusy, setStarterBusy] = useState(false);
  const [flyfotoPicker, setFlyfotoPicker] = useState(false);
  const [flyfotoProjects, setFlyfotoProjects] = useState<
    FlyfotoProject[] | null
  >(null);
  const [flyfotoProjectsError, setFlyfotoProjectsError] = useState(false);

  const access: LocalityAccess =
    user == null
      ? 'reader'
      : user.id === locality.owner
        ? 'owner'
        : isAdmin
          ? 'admin'
          : 'reader';

  const stance: Stance = editingId === locality.id ? 'edit' : 'show';

  // Two permissions because the server has two: `mayEdit` mirrors the update
  // and delete rules, while the create rules on `finds` and `attachments`
  // also demand the parent lokalitet's owner, so an admin adding content
  // collects a 403 after doing the work.
  const mayEdit = access !== 'reader';
  const mayAdd = access === 'owner';

  // Permission and stance folded together once here, so "nothing in show
  // writes" holds at every call site. A false gate renders the verb absent,
  // not disabled.
  const canEdit = mayEdit && stance === 'edit';
  const canAdd = mayAdd && stance === 'edit';

  // The edit transaction. The lokalitet's own fields are the exception to the
  // buffer: they go onto `activeLocalityAtom` live, because half the app reads
  // the rectangle off it. The buffer keeps the copy to put back.
  const localityRef = useRef(locality);
  localityRef.current = locality;

  const applyLocality = useCallback(
    (fields: Partial<DraftLocality>) => {
      const next = { ...localityRef.current, ...fields };
      upsertLocalityOnLayer(next);
      setActiveLocality(next);
    },
    [setActiveLocality],
  );

  const {
    draft,
    restoredAt,
    begin: beginDraft,
    mutate: mutateDraft,
    commit: commitDraft,
    rollback: rollbackDraft,
  } = useLocalityDraft({
    locality,
    userId: user?.id ?? null,
    recoverable: mayEdit,
    applyLocality,
  });

  // Recovery enters edit by itself: restoring a buffer without the stance
  // that owns it leaves the work on screen with no way to save it.
  useEffect(() => {
    if (restoredAt != null) setEditingId(locality.id);
  }, [restoredAt, locality.id, setEditingId]);

  // The buffer follows the stance rather than the entrance: stance without a
  // buffer loses work silently, since every write is a `mutateDraft` and that
  // is a no-op while `draft` is null. Reopening here rather than at the end of
  // `Lagre` / `Avbryt` runs a render later, so the new buffer's base is the
  // record as it now stands.
  useEffect(() => {
    if (stance === 'edit' && !draft) beginDraft();
  }, [stance, draft, beginDraft]);

  // Realtime stands down for the length of the transaction: the subscription
  // stays up, but an event raises a flag instead of reloading a list the
  // buffer is describing.
  const {
    items: serverFinds,
    changedElsewhere: findsChanged,
    reload: reloadFinds,
  } = useLocalityFinds(locality.id, stance === 'edit');
  const {
    items: serverAttachments,
    setItems: setAttachmentItems,
    changedElsewhere: attachmentsChanged,
    reload: reloadAttachments,
  } = useLocalityAttachments(locality.id, stance === 'edit');
  const changedElsewhere = findsChanged || attachmentsChanged;

  // What every surface reads: the server's lists with the buffer laid over.
  const ownerId = user?.id ?? locality.owner;
  const findItems = useMemo(
    () => overlayFinds(serverFinds, draft, locality.id, ownerId),
    [serverFinds, draft, locality.id, ownerId],
  );
  const attachmentItems = useMemo(
    () => overlayAttachments(serverAttachments, draft, locality.id, ownerId),
    [serverAttachments, draft, locality.id, ownerId],
  );

  // Deferred deletions, one set for both collections: PocketBase ids are
  // unique across them.
  const deletedIds = useMemo(
    () =>
      new Set<string>([
        ...(draft?.findDeletes ?? []),
        ...(draft?.attachmentDeletes ?? []),
      ]),
    [draft],
  );

  // A figure the pin queue just landed: its PATCH would normally arrive by
  // realtime, which is held back for the length of an edit session. Declared
  // here because the starter set enqueues before the queue's other verbs.
  const applyPinned = useCallback(
    (rec: AttachmentRecord) =>
      setAttachmentItems((prev) =>
        prev ? prev.map((it) => (it.id === rec.id ? rec : it)) : prev,
      ),
    [setAttachmentItems],
  );

  const dirty = isDirty(draft);
  const counts = useMemo(() => (draft ? draftCounts(draft) : null), [draft]);

  const restoreDeleted = useCallback(
    (id: string) => {
      mutateDraft((d) => undelete(d, id));
      const rec = findItems?.find((f) => f.id === id);
      if (rec) upsertFunnOnLayer(rec);
    },
    [mutateDraft, findItems],
  );

  // The exhibit. Positions differ between stances (edit shows the hidden
  // records too), so every ordering call below indexes into
  // `attachmentItems`, never into `bilderItems`.
  const { items: inheritedItems, unavailable: originalUnavailable } =
    useInheritedBilder(locality, serverAttachments, canAdd);

  // The borrowed tail: `derivedFrom`'s Files, which the copy did not carry.
  // A suffix of `bilderItems` and absent from `attachmentItems`, so a
  // position in the one is still a position in the other.
  const inheritedIds = useMemo(
    () => new Set(inheritedItems.map((rec) => rec.id)),
    [inheritedItems],
  );

  const bilderItems = useMemo(() => {
    if (!attachmentItems) return null;
    const own = canEdit
      ? attachmentItems
      : attachmentItems.filter((a) => !a.hidden);
    return inheritedItems.length > 0 ? [...own, ...inheritedItems] : own;
  }, [attachmentItems, canEdit, inheritedItems]);

  // Which bilde the bottom edge is pointing at. Here rather than in
  // BilderStrip because the strip unmounts when folded away and ←/→ walk it
  // from `useWorkspaceKeys`, mounted here.
  const [activeBildeId, setActiveBildeId] = useState<string | null>(null);

  // Sweep the cursor when the record leaves the rail. Only the cursor: a
  // layer member goes with its record for free, since `viewItems` /
  // `fileItems` apply the same filters and the `<GroundMember>` unmounts.
  useEffect(() => {
    if (
      activeBildeId &&
      bilderItems &&
      !bilderItems.some((a) => a.id === activeBildeId)
    ) {
      setActiveBildeId(null);
    }
  }, [activeBildeId, bilderItems]);

  /** Point the rail at a record without touching the map, for the surface
   *  selecting for you; `selectBilde` is the press, and does both. */
  const focusBilde = useCallback((id: string | null) => {
    setActiveBildeId(id);
  }, []);

  // The other direction: exactly one bilde on the map moves the rail cursor
  // to it, since one is the only arrangement a single cursor can describe.
  useEffect(() => {
    const shown = [...visningShown, ...bildeShown, ...sketchShown];
    if (shown.length !== 1) return;
    const id = shown[0];
    // A shown set is never pruned, so it can still name a record that has
    // left the rail.
    if (!bilderItems?.some((a) => a.id === id)) return;
    setActiveBildeId((cur) => (cur === id ? cur : id));
  }, [visningShown, bildeShown, sketchShown, bilderItems]);

  // `Slett bildet` goes out immediately rather than into the buffer. A
  // buffered spec never reached the server, so dropping it from `newSpecs` is
  // the whole operation; realtime stands down in edit, so the list has to be
  // updated by hand; and on failure the tombstone stays and `Lagre` retries
  // the DELETE — the one path on which `deletedIds` covers an attachment.
  const removeBilde = useCallback(
    async (rec: AttachmentRecord) => {
      mutateDraft((d) => dropAttachment(d, rec.id));
      setActiveBildeId((cur) => (cur === rec.id ? null : cur));
      if (isDraftId(rec.id)) return;
      try {
        await deleteAttachment(rec.id);
      } catch (e) {
        console.warn('[locality] bilde delete failed', e);
        toast.error({ title: t('localities.bilder.deleteFailed') });
        return;
      }
      mutateDraft((d) => forgetAttachment(d, rec.id));
      setAttachmentItems((prev) =>
        prev ? prev.filter((it) => it.id !== rec.id) : prev,
      );
    },
    [mutateDraft, setAttachmentItems, t],
  );

  // The four curation columns, into the buffer. `meta` is deliberately out of
  // the signature: a caption edit must never be able to carry a spec.
  const patchBilde = useCallback(
    (
      rec: AttachmentRecord,
      patch: {
        caption?: string;
        sort?: number;
        hidden?: boolean;
        funn?: string[];
      },
    ) => {
      mutateDraft((d) =>
        withAttachment(d, rec.id, attachmentBaseOf(rec), patch),
      );
    },
    [mutateDraft],
  );

  const setBildeCaption = useCallback(
    (rec: AttachmentRecord, caption: string) => patchBilde(rec, { caption }),
    [patchBilde],
  );

  // Which funn this bilde belongs to: one id or none, written as the whole
  // array, so a record that somehow holds two is corrected by the first edit.
  const setBildeFunn = useCallback(
    (rec: AttachmentRecord, funnId: string | null) =>
      patchBilde(rec, { funn: funnId ? [funnId] : [] }),
    [patchBilde],
  );

  const setBildeHidden = useCallback(
    (rec: AttachmentRecord, hidden: boolean) => patchBilde(rec, { hidden }),
    [patchBilde],
  );

  // `Plasser i ruta` and its undo: give an upload an assumed extent. The
  // whole `meta` goes in the patch, never the one key — PocketBase replaces a
  // JSON field wholesale, so a partial patch deletes everything it left out.
  const placeUpload = useCallback(
    async (rec: AttachmentRecord) => {
      if (!canEdit) return;
      try {
        const aspect = await imageAspectOf(rec);
        const meta: Record<string, unknown> = {
          ...(rec.meta ?? {}),
          bbox25833: assumedExtentOf(locality.bbox, aspect),
          bboxAssumed: true,
        };
        mutateDraft((d) =>
          withAttachment(d, rec.id, attachmentBaseOf(rec), { meta }),
        );
      } catch (e) {
        console.warn('[locality] place upload failed', rec.id, e);
        toast.error({ title: t('localities.bilder.placeFailed') });
      }
    },
    [canEdit, locality.bbox, mutateDraft, t],
  );

  const unplaceUpload = useCallback(
    (rec: AttachmentRecord) => {
      if (!canEdit) return;
      const meta: Record<string, unknown> = { ...(rec.meta ?? {}) };
      delete meta.bbox25833;
      delete meta.bboxAssumed;
      mutateDraft((d) =>
        withAttachment(d, rec.id, attachmentBaseOf(rec), { meta }),
      );
    },
    [canEdit, mutateDraft],
  );

  // `sort` is opaque: the ordinary move picks a value between the two new
  // neighbours and costs one PATCH, with a full renumber as the fallback when
  // there is no gap. Self-healing, since a renumber respaces by `SORT_STEP`.
  const reorderBilde = useCallback(
    (id: string, toIndex: number) => {
      const list = attachmentItems;
      if (!list) return;
      const from = list.findIndex((a) => a.id === id);
      if (from < 0) return;
      const to = Math.max(0, Math.min(list.length - 1, toIndex));
      if (to === from) return;

      const rest = list.filter((a) => a.id !== id);
      const next = [...rest.slice(0, to), list[from], ...rest.slice(to)];

      const before = rest[to - 1] ?? null;
      const after = rest[to] ?? null;
      const between = () => {
        if (before && after) {
          const mid = Math.floor((before.sort + after.sort) / 2);
          return mid > before.sort && mid < after.sort ? mid : null;
        }
        if (before) return before.sort + SORT_STEP;
        if (after) return after.sort - SORT_STEP;
        return SORT_STEP;
      };

      const value = between();
      if (value != null) {
        patchBilde(list[from], { sort: value });
        return;
      }
      // No room: space the whole exhibit out again in the order it now reads.
      for (let i = 0; i < next.length; i++) {
        patchBilde(next[i], { sort: (i + 1) * SORT_STEP });
      }
    },
    [attachmentItems, patchBilde],
  );

  // Funn draft. `draftFunnId` is the record the pen is bound to — null only
  // until the first shape closes, since drawing autosaves. `draftIsEdit`
  // distinguishes a new funn from "Rediger tegningen" on an existing one.
  const [draftFunnId, setDraftFunnId] = useState<string | null>(null);
  const [draftIsEdit, setDraftIsEdit] = useState(false);
  const [funnTitle, setFunnTitle] = useState('');
  // What "Rediger tegningen" started from, so `Forkast funn` can put it back.
  const [geometryBefore, setGeometryBefore] = useState<DraftFind | null>(null);
  // The autosave's flush, handed over once that hook has run further down. A
  // ref because the two halves point at each other: the hook is driven by
  // callbacks defined here, and those callbacks must be able to write out
  // whatever is still settling.
  const flushDraftRef = useRef<() => void>(() => {});

  useEffect(() => {
    setLocalityHighlight(locality.id);
    return () => setLocalityHighlight(null);
  }, [locality.id]);

  // Draft/adjust/tool/selection cleanup when the workspace closes or
  // swaps lokalitet.
  useEffect(() => {
    return () => {
      // Before the pen goes up, not after: closing the workspace mid-stroke
      // should write the stroke, and the scene is still on the surface.
      flushDraftRef.current();
      setDrawRequested(null);
      setAdjusting(false);
      setTool(null);
      setSelectedFunnId(null);
      setFunnOutside(false);
      hideFunnOnLayer(null);
      // All of the following are keyed by this lokalitet's find or attachment
      // ids, so a set left standing would come back with the next lokalitet
      // and hide or fade records it never names.
      setFunnSwitchedOff(new Set());
      setSketchOverlays([]);
      setSketchShown(new Set());
      setSketchOpacityMap(new Map());
      setSketchGroupShown(true);
      // [Visning]'s group switch can leave the map with no background at all,
      // so a lokalitet closed with it off would hand the next one a white
      // screen. `VisningControl` restores the tile layers on unmount; a swap
      // does not unmount it, hence this.
      setVisningShown(new Set());
      setVisningOpacity(new Map());
      setVisningGroupShown(true);
      // Latched to an id in the set just emptied.
      setProvisionalView(null);
      setBildeShown(new Set());
      setBildeOpacity(new Map());
      setBildeGroupShown(true);
      // Sammenlign's only control is on the lokalitet row, so leaving with the
      // curtain up strands a second live tile stack with no way to close it.
      leaveCompare();
    };
  }, [
    locality.id,
    setDrawRequested,
    setAdjusting,
    setTool,
    setSelectedFunnId,
    setFunnOutside,
    setFunnSwitchedOff,
    setSketchShown,
    setSketchOpacityMap,
    setSketchGroupShown,
    setVisningShown,
    setVisningOpacity,
    setVisningGroupShown,
    setProvisionalView,
    setBildeShown,
    setBildeOpacity,
    setBildeGroupShown,
    leaveCompare,
  ]);

  // Nothing remounts on a lokalitet swap, so the funn draft is cleared here.
  useEffect(() => {
    setDraftFunnId(null);
    setDraftIsEdit(false);
    setFunnTitle('');
    setGeometryBefore(null);
  }, [locality.id]);

  // The lokalitet's own fields: onto the live record and into the buffer. The
  // atom write is not optimistic — there is no request; it is where the value
  // lives until `Lagre`, because that is where every other module reads it.
  const patchLocality = useCallback(
    (patch: LocalityPatch) => {
      applyLocality(patch);
      mutateDraft((d) => withLocality(d, patch));
    },
    [applyLocality, mutateDraft],
  );

  const close = useCallback(() => setActiveLocality(null), [setActiveLocality]);

  // `Rediger` only sets the stance; the buffer follows it, above.
  const enterEdit = useCallback(() => {
    if (!mayEdit) return;
    setEditingId(locality.id);
  }, [mayEdit, locality.id, setEditingId]);

  // Stance leaves on unmount, but only if it is still this record's: the
  // creators set the atom in the same batch as `activeLocalityAtom`, so a new
  // lokalitet's id is already in it when the outgoing cleanup runs and
  // clearing unconditionally would put the new record back into show.
  useEffect(
    () => () => setEditingId((cur) => (cur === locality.id ? null : cur)),
    [locality.id, setEditingId],
  );

  // `Lag min kopi`: copies, swaps you to the copy, and drops you in edit
  // there. The prompt is where what does and does not come along gets said,
  // so it is not skipped for an empty lokalitet.
  const openCopyPrompt = useCallback(() => setCopyPrompt(true), []);
  const closeCopyPrompt = useCallback(() => setCopyPrompt(false), []);

  const confirmCopy = useCallback(async () => {
    if (!user || copyProgress) return;
    setCopyPrompt(false);
    setCopyProgress({ stage: 'finds', done: 0, total: 0 });
    try {
      const result = await copyLocality({
        source: locality,
        finds: findItems ?? [],
        attachments: attachmentItems ?? [],
        userId: user.id,
        onProgress: setCopyProgress,
      });
      if (!result) {
        toast.error({ title: t('localities.copy.failed') });
        return;
      }
      if (result.failed > 0) {
        toast.error({
          title: t('localities.copy.partial', { count: result.failed }),
        });
      }
      // Same batch, so the row never renders the copy in show first.
      setActiveLocality(result.rec);
      setEditingId(result.rec.id);
    } finally {
      setCopyProgress(null);
    }
  }, [
    user,
    copyProgress,
    locality,
    findItems,
    attachmentItems,
    setActiveLocality,
    setEditingId,
    t,
  ]);

  // Fetched rather than assumed reachable: `derivedFrom` is
  // `cascadeDelete: false`, so the relation outlives the record it points at,
  // and outlives that record being un-shared.
  const openOriginal = useCallback(async () => {
    const id = locality.derivedFrom;
    if (!id) return;
    try {
      const rec = await getLocality(id);
      upsertLocalityOnLayer(rec);
      setActiveLocality(rec);
    } catch (e) {
      console.warn('[localityWorkspace] original unavailable', id, e);
      toast.error({ title: t('localities.copy.originalGone') });
    }
  }, [locality.derivedFrom, setActiveLocality, t]);

  const rename = useCallback(
    async (next: string) => {
      const trimmed = next.trim();
      if (trimmed.length === 0 || trimmed === locality.name) return false;
      patchLocality({ name: trimmed });
      return true;
    },
    [locality.name, patchLocality],
  );

  const zoomToLocality = useCallback(() => {
    const projection = map.getView().getProjection().getCode();
    const extent = transformExtent(locality.bbox, 'EPSG:4326', projection);
    map.getView().fit(extent, {
      // Measured: the ribbon and the bottom edge each take an unpredictable
      // slice of the canvas.
      padding: fitPadding(map),
      maxZoom: 18,
      duration: 400,
    });
  }, [map, locality.bbox]);

  // Keyed on the id and not the bbox: re-fitting on every bbox change would
  // fight the "Juster området" drag, which persists after every gesture.
  useEffect(() => {
    zoomToLocality();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locality.id]);

  // Not deferred: the record the transaction is about is going away, so the
  // buffer goes with it.
  const removeLocality = useCallback(async () => {
    try {
      await deleteLocality(locality.id);
      clearDraft(locality.id);
      removeLocalityFromLayer(locality.id);
      setActiveLocality(null);
    } catch (e) {
      console.warn('[localityWorkspace] delete failed', e);
      toast.error({ title: t('localities.workspace.saveFailed') });
    }
  }, [locality.id, setActiveLocality, t]);

  // Stopping is not discarding: the funn is already in the buffer, so this
  // only flushes what is settling and puts the pen down.
  const stopDraft = useCallback(() => {
    flushDraftRef.current();
    setDrawRequested(null);
    hideFunnOnLayer(null);
    if (draftFunnId) {
      const rec = findItems?.find((it) => it.id === draftFunnId);
      // The flush a line ago may not be in state yet; the buffer's re-render
      // puts the newer shape up a tick later.
      if (rec) upsertFunnOnLayer(rec);
    }
    setDraftFunnId(null);
    setDraftIsEdit(false);
  }, [draftFunnId, findItems, setDrawRequested]);

  // End whichever drawing session is up: a funn draft has a record to settle
  // and a layer to restore, a sketch has neither. Callers need not know which.
  const putPenDown = useCallback(() => {
    if (draftActive) stopDraft();
    else setDrawRequested(null);
  }, [draftActive, stopDraft, setDrawRequested]);

  // First finished shape becomes a row in the buffer. Title falls back to a
  // running number rather than blocking on one being typed.
  const createDraftFunn = useCallback(
    async (geometry: FeatureCollection): Promise<boolean> => {
      if (!user) return false;
      const id = mintDraftId();
      const body: DraftFind = {
        title:
          funnTitle.trim() ||
          t('localities.funn.autoName', { n: (findItems?.length ?? 0) + 1 }),
        note: '',
        status: 'mulig',
        geometry,
      };
      mutateDraft((d) => withNewFind(d, id, body));
      // The shapes are on the draw layer already; keep the funn layer's copy
      // out from under them until drawing stops.
      hideFunnOnLayer(id);
      setDraftFunnId(id);
      setFunnTitle(body.title);
      setSelectedFunnId(id);
      return true;
    },
    [user, findItems, funnTitle, mutateDraft, setSelectedFunnId, t],
  );

  const updateDraftGeometry = useCallback(
    async (id: string, geometry: FeatureCollection): Promise<boolean> => {
      const base = findItems?.find((it) => it.id === id);
      if (!base) return false;
      mutateDraft((d) => withFind(d, id, findBaseOf(base), { geometry }));
      return true;
    },
    [findItems, mutateDraft],
  );

  // The extent is kept as well as compared, because `Utvid området` needs the
  // rectangle and not just the verdict. Both come from the autosave's settle,
  // so they can never describe different drawings.
  const drawnExtent = useRef<LocalityBbox | null>(null);
  const reportDrawnExtent = useCallback(
    (extent: LocalityBbox | null) => {
      drawnExtent.current = extent;
      setFunnOutside(extent != null && !bboxContains(locality.bbox, extent));
    },
    [locality.bbox, setFunnOutside],
  );

  const autosave = useFunnAutosave({
    active: draftActive,
    funnId: draftFunnId,
    onCreate: createDraftFunn,
    onUpdate: updateDraftGeometry,
    onExtent: reportDrawnExtent,
  });
  flushDraftRef.current = autosave.flush;

  const growToFitDrawing = useCallback(() => {
    const drawn = drawnExtent.current;
    if (!drawn) return;
    const grown = bboxUnion(locality.bbox, drawn);
    // The size band refuses here rather than clamping: a clamped union would
    // leave the funn outside the rectangle it was grown to hold.
    if (bboxExceedsMax(grown)) {
      toast.error({
        title: t('localities.funn.growTooLarge', { max: MAX_SIDE_M }),
      });
      return;
    }
    patchLocality({ bbox: grown });
    setFunnOutside(false);
  }, [locality.bbox, patchLocality, setFunnOutside, t]);

  // The pen freezes the map, so anything else that wants it goes down.
  // Terreng stays: tracing what it shows is the point of having it up.
  const clearForPen = useCallback(() => {
    putPenDown();
    setAdjusting(false);
    setTool((cur) => (cur === 'lidar' ? null : cur));
  }, [putPenDown, setAdjusting, setTool]);

  const startDraft = useCallback(() => {
    if (!canAdd || draftActive) return;
    clearForPen();
    hideFunnOnLayer(null);
    // Drawing with the existing funn invisible is how you draw one twice. The
    // group flag only — it can be set by a keystroke and takes everything
    // away; a per-member switch is a deliberate statement and is left alone.
    setFunnHidden(false);
    setDraftFunnId(null);
    setDraftIsEdit(false);
    setFunnTitle('');
    setGeometryBefore(null);
    setDrawRequested({ mode: 'funn' });
  }, [canAdd, draftActive, clearForPen, setFunnHidden, setDrawRequested]);

  // `Rediger tegningen`: the geometry goes up as the request's `seed` and the
  // surface converts it into whatever frame it captures. A `seed` and not a
  // `resume` — a funn is geometry and has no scene registered to a frame.
  const startGeometryEdit = useCallback(
    (f: LocalityFindRecord) => {
      if (!canAdd) return;
      clearForPen();
      hideFunnOnLayer(f.id);
      setDraftFunnId(f.id);
      setDraftIsEdit(true);
      setFunnTitle(f.title);
      // From the overlaid record, so a second edit in the same session
      // restores the first one's result rather than the server's copy.
      setGeometryBefore(findBaseOf(f));
      setDrawRequested({ mode: 'funn', seed: f.geometry });
    },
    [canAdd, clearForPen, setDrawRequested],
  );

  // `Tegn`: the same pen making a layer instead of a funn. A funn is stored as
  // geometry, a sketch as the strokes, so which is being made is decided
  // before the pen goes down rather than by a mode switch.
  const startSketch = useCallback(() => {
    if (!canAdd || sketchActive) return;
    clearForPen();
    setDrawRequested({ mode: 'sketch' });
  }, [canAdd, sketchActive, clearForPen, setDrawRequested]);

  // `Rediger skissen`: a resume, not a seed — the scene is registered to the
  // rectangle it was drawn over, and the surface flies back to it rather than
  // re-registering the strokes to wherever the map is standing.
  const resumeSketch = useCallback(
    (rec: AttachmentRecord) => {
      if (!canAdd) return;
      const stored = sketchSceneOf(rec.meta);
      if (!stored) {
        toast.error({ title: t('localities.sketch.unreadable') });
        return;
      }
      clearForPen();
      setDrawRequested({
        mode: 'sketch',
        resume: { id: rec.id, scene: stored },
      });
    },
    [canAdd, clearForPen, setDrawRequested, t],
  );

  const stopSketch = useCallback(
    () => setDrawRequested(null),
    [setDrawRequested],
  );

  const sketchCount = useMemo(
    () => (attachmentItems ?? []).filter((it) => it.kind === 'sketch').length,
    [attachmentItems],
  );

  // `Behold skissen`: the scene into the buffer as a View, `meta` carrying the
  // whole of it including `frame`, the rectangle the strokes are registered
  // to. `funn` and `over` are seeded from what was on screen; neither cascades.
  const keepSketch = useCallback(() => {
    if (!user || !canAdd) return;
    if (!drawSession || drawSession.mode !== 'sketch') return;
    // The live scene, not the settled one: a sketch whose only stroke is still
    // inside the settle would be refused as empty by the next line.
    const elements = storableScene(sceneNow(scene));
    if (elements.length === 0) {
      toast.error({ title: t('localities.sketch.empty') });
      return;
    }
    // Refused here rather than at `Lagre`, where it would be one failed row
    // among the session's writes.
    if (sceneBytes(elements) > SCENE_BUDGET_BYTES) {
      toast.error({ title: t('localities.sketch.tooBig') });
      return;
    }
    const meta = { frame: drawSession.frame, scene: elements };
    const resumed = drawSession.resume;
    if (resumed) {
      const rec = attachmentItems?.find((it) => it.id === resumed.id);
      // Deleted while it was being drawn on; keeping it would resurrect it.
      if (!rec) {
        toast.error({ title: t('localities.sketch.unreadable') });
        setDrawRequested(null);
        return;
      }
      mutateDraft((d) =>
        withAttachment(d, resumed.id, attachmentBaseOf(rec), { meta }),
      );
    } else {
      const born = Date.now();
      const id = mintDraftId();
      // Every layer under the pen, bottom to top: [Visning]'s members then
      // [Bilde]'s. The ground preset cannot be in it — `over` relates to
      // attachments.
      const items = attachmentItems ?? [];
      const over = [
        ...items.filter((it) => visningShown.has(it.id)),
        ...items.filter((it) => bildeShown.has(it.id)),
      ].map((it) => it.id);
      mutateDraft((d) =>
        withNewSpec(d, id, {
          kind: 'sketch',
          caption: t('localities.sketch.caption', { n: sketchCount + 1 }),
          sort: born,
          bornSort: born,
          hidden: false,
          meta,
          funn: selectedFunnId ? [selectedFunnId] : [],
          over,
        }),
      );
      setSketchShown((cur) => new Set(cur).add(id));
    }
    setDrawRequested(null);
    toast.success({ title: t('localities.sketch.kept') });
  }, [
    user,
    canAdd,
    drawSession,
    scene,
    attachmentItems,
    sketchCount,
    selectedFunnId,
    visningShown,
    bildeShown,
    mutateDraft,
    setSketchShown,
    setDrawRequested,
    t,
  ]);

  // The card's eye and [Skisse]'s member row are two surfaces on one set, so
  // they cannot disagree about what is on the map.
  const toggleSketch = useCallback(
    (id: string) =>
      setSketchShown((cur) => {
        const next = new Set(cur);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [setSketchShown],
  );

  /** One member's fade, 0–100. */
  const setSketchOpacity = useCallback(
    (id: string, value: number) =>
      setSketchOpacityMap((cur) => new Map(cur).set(id, value)),
    [setSketchOpacityMap],
  );

  const toggleSketchGroup = useCallback(
    () => setSketchGroupShown((cur) => !cur),
    [setSketchGroupShown],
  );

  // What [Skisse] lists. Hidden ones are in, in edit only, so curation is not
  // a way to lose your own images; the one under the pen is out, since its
  // strokes are on the drawing surface and its switch would do nothing.
  const sketchItems = useMemo(
    () =>
      (attachmentItems ?? []).filter(
        (it) =>
          it.kind === 'sketch' &&
          !deletedIds.has(it.id) &&
          (canEdit || !it.hidden) &&
          drawSession?.resume?.id !== it.id,
      ),
    [attachmentItems, deletedIds, canEdit, drawSession],
  );

  // What [Visning] lists: the Views over the lokalitet's own rectangle. A
  // terrain render is stored as an `extract`, so two kinds cover three
  // producers.
  const viewItems = useMemo(
    () =>
      (attachmentItems ?? []).filter(
        (it) =>
          (it.kind === 'extract' || it.kind === 'flyfoto') &&
          !deletedIds.has(it.id) &&
          (canEdit || !it.hidden),
      ),
    [attachmentItems, deletedIds, canEdit],
  );

  // What [Bilde] lists. A File is bytes with nothing to render from, so the
  // two extra filters: no file means no member, and `bbox25833` is what says
  // where the bytes go — an upload gets one only from `Plasser i ruta`.
  const fileItems = useMemo(
    () =>
      (attachmentItems ?? []).filter(
        (it) =>
          (it.kind === 'screenshot' || it.kind === 'upload') &&
          it.file !== '' &&
          !deletedIds.has(it.id) &&
          (canEdit || !it.hidden) &&
          groundExtentOf(it.meta ?? {}) != null,
      ),
    [attachmentItems, deletedIds, canEdit],
  );

  // The shown sketches onto the map, declared as a whole set on every change,
  // in the order [Skisse] lists them — the pulldown groups by funn, and
  // position in the row means depth on the map. The parse is cached on the
  // `meta` object's identity: `sketchSceneOf` builds a new scene each call and
  // the overlay module compares element arrays by reference, so an uncached
  // parse would re-render every sketch on every keystroke.
  const sceneCache = useRef(new WeakMap<object, SketchScene | null>());
  useEffect(() => {
    const cache = sceneCache.current;
    const overlays: SketchOverlay[] = [];
    for (const rec of orderedByFunn(attachmentItems ?? [], findItems)) {
      if (rec.kind !== 'sketch' || !rec.meta) continue;
      if (!sketchShown.has(rec.id) || deletedIds.has(rec.id)) continue;
      // The one under the pen is on the surface already; a second copy would
      // be the pre-edit strokes showing through the drawing.
      if (drawSession?.resume?.id === rec.id) continue;
      let stored = cache.get(rec.meta);
      if (stored === undefined) {
        stored = sketchSceneOf(rec.meta);
        cache.set(rec.meta, stored);
      }
      if (!stored) continue;
      overlays.push({
        id: rec.id,
        frame: stored.frame,
        elements: stored.elements,
        // Percent on this side of the boundary, 0–1 on the other.
        opacity: (sketchOpacity.get(rec.id) ?? 100) / 100,
      });
    }
    setSketchOverlays(overlays, sketchGroupShown);
  }, [
    attachmentItems,
    findItems,
    sketchShown,
    sketchOpacity,
    sketchGroupShown,
    deletedIds,
    drawSession,
  ]);

  // `Hent → LiDAR-uttrekk`. Nothing to seed: every image in a lokalitet covers
  // the lokalitet's rectangle, so the tool is a flag on `ribbonToolAtom`,
  // which is also what gives it `U`, the Escape depth and exclusion with
  // Terreng.
  const openLidar = useCallback(() => {
    putPenDown();
    setAdjusting(false);
    setTool('lidar');
  }, [putPenDown, setAdjusting, setTool]);

  const closeLidar = useCallback(() => {
    setTool((cur) => (cur === 'lidar' ? null : cur));
  }, [setTool]);

  const toggleLidar = useCallback(() => {
    if (tool === 'lidar') closeLidar();
    else openLidar();
  }, [tool, closeLidar, openLidar]);

  // Entering and leaving Terreng are row 1's job and arrive as a plain write
  // to ribbonToolAtom, so the slot's cleanup has to be an effect rather than
  // something a handler here does on the way in.
  useEffect(() => {
    if (tool !== 'terrain') return;
    setAdjusting(false);
  }, [tool, setAdjusting]);

  // `Juster området`'s own little transaction inside the edit buffer: `Angre`
  // puts the rectangle back without throwing the whole session away.
  const [bboxBefore, setBboxBefore] = useState<LocalityBbox | null>(null);

  const toggleAdjusting = useCallback(() => {
    if (adjusting) {
      setAdjusting(false);
      setBboxBefore(null);
      return;
    }
    putPenDown();
    setBboxBefore(localityRef.current.bbox);
    setAdjusting(true);
  }, [adjusting, putPenDown, setAdjusting]);

  /** `Bruk`: keep where the rectangle ended up, still buffered. */
  const applyAdjust = useCallback(() => {
    setAdjusting(false);
    setBboxBefore(null);
  }, [setAdjusting]);

  /** `Angre`: put it back where the gesture started. */
  const undoAdjust = useCallback(() => {
    if (bboxBefore) patchLocality({ bbox: bboxBefore });
    setAdjusting(false);
    setBboxBefore(null);
  }, [bboxBefore, patchLocality, setAdjusting]);

  const onAdjustBbox = useCallback(
    (bbox: LocalityBbox) => patchLocality({ bbox }),
    [patchLocality],
  );
  useLocalityAdjust(locality, onAdjustBbox);

  const [saving, setSaving] = useState(false);

  // Both exits from edit go through here: every edit-only tool is a write
  // surface and must not be left armed in show.
  const standDown = useCallback(() => {
    putPenDown();
    setAdjusting(false);
    setBboxBefore(null);
    closeLidar();
    setEditingId((cur) => (cur === locality.id ? null : cur));
  }, [putPenDown, setAdjusting, closeLidar, locality.id, setEditingId]);

  /**
   * `Lagre`: commits the buffer and keeps the stance; the buffer reopens by
   * itself. Pins go out behind it rather than being awaited. Returns whether
   * everything landed, so "Lagre og avslutt" does not leave on a half-failure.
   */
  const saveEdit = useCallback(async (): Promise<boolean> => {
    if (saving) return false;
    if (draftActive) flushDraftRef.current();
    setSaving(true);
    // Read before the commit, because the flush above may still be in the
    // same tick as the state it wrote.
    const wasChangedElsewhere = changedElsewhere;
    try {
      const result = await commitDraft();
      if (result.ok) {
        // The buffered shapes on the map were pushed on under temporary ids;
        // the records that just landed have real ones.
        refreshFunnLayer();
        // Realtime is still held back and the buffer the overlay was reading
        // the new rows out of is now empty, so the lists must be asked again.
        // Safe only here: the buffer was just played out.
        reloadFinds();
        reloadAttachments();
      }
      // A shown sketch is remembered by the draft id the commit just
      // replaced; without this its overlay comes off the map on `Lagre`.
      const renamed = result.renamedSpecs;
      if (renamed.size > 0) {
        setSketchShown(
          (cur) => new Set([...cur].map((id) => renamed.get(id) ?? id)),
        );
      }
      for (const rec of result.created) {
        enqueuePin({
          rec,
          bbox4326: localityRef.current.bbox,
          subject: localityRef.current.name || undefined,
          onPinned: applyPinned,
        });
      }
      if (!result.ok) {
        // The buffer now holds exactly what did not land, so `Lagre` again
        // retries that remainder.
        toast.error({
          title: t('localities.edit.saveFailed', { count: result.failed }),
        });
      } else if (wasChangedElsewhere) {
        // Last write wins; say so rather than doing it silently.
        toast.create({ title: t('localities.edit.changedElsewhere') });
      }
      return result.ok;
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    draftActive,
    changedElsewhere,
    commitDraft,
    reloadFinds,
    reloadAttachments,
    setSketchShown,
    applyPinned,
    t,
  ]);

  /** `Avbryt`: drop the buffer and delete the eagerly written Files. The
   *  stance stays and a fresh buffer opens behind this one; the confirm lives
   *  on the row, so by the time this runs the decision is made. */
  const cancelEdit = useCallback(async () => {
    const eager = draft?.eagerIds ?? [];
    if (eager.length > 0) {
      setAttachmentItems((prev) =>
        prev ? prev.filter((it) => !eager.includes(it.id)) : prev,
      );
    }
    // Buffered shapes went onto the layer by hand; the server's copy is the
    // truth again.
    refreshFunnLayer();
    const stuck = await rollbackDraft();
    if (stuck > 0) {
      toast.error({
        title: t('localities.edit.rollbackFailed', { count: stuck }),
      });
    }
  }, [draft, setAttachmentItems, rollbackDraft, t]);

  /** `Avslutt`: put the edit-only tools down and leave the stance. The
   *  rollback rides along even on a clean buffer, so no stale `baseLocality`
   *  is left open in show. */
  const exitEdit = useCallback(async () => {
    standDown();
    await cancelEdit();
  }, [standDown, cancelEdit]);

  const takeScreenshot = useCallback(async () => {
    if (!user || !canAdd || shooting) return;
    setShooting(true);
    try {
      const shot = await captureLocalityScreenshot(map, locality.bbox);
      if (!shot) {
        toast.error({ title: t('localities.tools.screenshotFailed') });
        return;
      }
      const figure = await renderFigureBlob(
        shot.canvas,
        screenshotFigure({
          subject: locality.name || undefined,
          groundLabel: compareOn
            ? t('figure.source.compareGrounds', {
                left: t(groundLabelKey(background, hybrid)),
                right: t(groundLabelKey(backgroundB, hybridB)),
              })
            : t(groundLabelKey(background, hybrid)),
          groundIsFlyfoto:
            NIB_GROUNDS.has(background) ||
            (compareOn && NIB_GROUNDS.has(backgroundB)),
          themeLayers: [...themeLayers],
          heritageRender: themeLayers.has('heritageSites')
            ? describeHeritageRender(
                heritageDetails,
                heritageRender,
                heritageOpacity,
              )
            : undefined,
          metresPerPx: shot.metresPerPx,
          bbox25833: shot.bbox25833,
          rotation: shot.rotation,
          language: i18n.language,
        }),
      );
      if (!figure) {
        toast.error({ title: t('localities.tools.screenshotFailed') });
        return;
      }
      const rec = await createAttachment(
        {
          locality: locality.id,
          kind: 'screenshot',
          caption: `${t('localities.tools.screenshotCaption')} ${new Date().toLocaleDateString(i18n.language)}`,
          meta: {
            bbox25833: shot.bbox25833,
            metresPerPx: figure.metresPerPx,
            imageRect: figure.imageRect,
            // What was on the map when the shutter went, machine-readable
            // beside the caption's prose. Not enough to restore the view, and
            // not meant to be: a screenshot is a File, not a View.
            ground: background,
            hybrid,
            themeLayers: [...themeLayers],
            ...(compareOn
              ? { compare: { ground: backgroundB, hybrid: hybridB } }
              : {}),
            ...(themeLayers.has('heritageSites')
              ? {
                  heritage: {
                    details: [...heritageDetails],
                    render: heritageRender,
                    opacity: heritageOpacity,
                  },
                }
              : {}),
          },
        },
        user.id,
        figure.blob,
        'skjermbilde.png',
      );
      setAttachmentItems((prev) => (prev ? [...prev, rec] : [rec]));
      // Written eagerly, so the transaction owes a DELETE on `Avbryt`: a
      // multi-megabyte blob cannot live in the `localStorage` buffer.
      mutateDraft((d) => withEager(d, rec.id));
      toast.success({ title: t('localities.tools.screenshotSaved') });
    } catch (e) {
      console.warn('[localityWorkspace] screenshot failed', e);
      toast.error({ title: t('localities.tools.screenshotFailed') });
    } finally {
      setShooting(false);
    }
  }, [
    user,
    canAdd,
    shooting,
    map,
    locality.id,
    locality.name,
    locality.bbox,
    background,
    hybrid,
    compareOn,
    backgroundB,
    hybridB,
    themeLayers,
    heritageDetails,
    heritageRender,
    heritageOpacity,
    setAttachmentItems,
    mutateDraft,
    t,
    i18n.language,
  ]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!user || !canAdd || uploading) return;
      setUploading(true);
      try {
        const rec = await createAttachment(
          { locality: locality.id, kind: 'upload' },
          user.id,
          file,
          file.name,
        );
        setAttachmentItems((prev) => (prev ? [...prev, rec] : [rec]));
        mutateDraft((d) => withEager(d, rec.id));
      } catch (e) {
        console.warn('[localityWorkspace] upload failed', e);
        toast.error({ title: t('localities.bilder.uploadFailed') });
      } finally {
        setUploading(false);
      }
    },
    [user, canAdd, uploading, locality.id, setAttachmentItems, mutateDraft, t],
  );

  // `Ta med`: pull one of the original's Files into this copy, bytes down and
  // back up. Eager and compensated on `Avbryt` like every File write;
  // `meta.takenFrom` keeps the card off the borrowed tail afterwards.
  const takeBilde = useCallback(
    async (rec: AttachmentRecord) => {
      if (!user || !canAdd || takingId) return;
      setTakingId(rec.id);
      try {
        const url = getAttachmentUrl(rec);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const copy = await createAttachment(
          {
            locality: locality.id,
            kind: rec.kind,
            caption: rec.caption,
            // Its place in the original's arrangement comes with it.
            sort: rec.sort,
            hidden: rec.hidden,
            meta: { ...(rec.meta ?? {}), takenFrom: rec.id },
          },
          user.id,
          blob,
          rec.file,
        );
        setAttachmentItems((prev) => (prev ? [...prev, copy] : [copy]));
        mutateDraft((d) => withEager(d, copy.id));
        setActiveBildeId(copy.id);
      } catch (e) {
        console.warn('[localityWorkspace] take failed', rec.id, e);
        toast.error({ title: t('localities.copy.takeFailed') });
      } finally {
        setTakingId(null);
      }
    },
    [user, canAdd, takingId, locality.id, setAttachmentItems, mutateDraft, t],
  );

  // The acquisition list is per-rectangle, so drop it when the rectangle
  // moves. Keyed on the values: the array is a fresh identity every update.
  const bboxKey = locality.bbox.join(',');
  useEffect(() => {
    setFlyfotoProjects(null);
    setFlyfotoProjectsError(false);
  }, [bboxKey]);

  // The rectangle in EPSG:25833, the CRS every producer and every stored
  // `meta` works in, and the "same ground?" half of the duplicate guard.
  const beholdBbox = useMemo(
    () =>
      transformExtent(locality.bbox, 'EPSG:4326', 'EPSG:25833') as [
        number,
        number,
        number,
        number,
      ],
    [locality.bbox],
  );

  // One grab is one buffered row naming the acquisition, not a stitch; the
  // pin queue fetches the pixels after `Lagre`. Returns whether the row was
  // written, which means "kept", not "turned out to have coverage".
  const grabFlyfoto = useCallback(
    (project?: FlyfotoProject): boolean => {
      if (!user || !canAdd) return false;
      const label = project
        ? (project.year?.toString() ?? project.projectName)
        : t('localities.tools.flyfotoMosaic');
      const born = Date.now();
      const spec: DraftSpec = {
        kind: 'flyfoto',
        // A project's year makes the gallery readable as a time series; the
        // mosaic has none, so it gets the date it was grabbed.
        caption: `${t('localities.tools.flyfotoCaption')} ${
          project ? label : new Date().toLocaleDateString(i18n.language)
        }`,
        sort: born,
        bornSort: born,
        hidden: false,
        // Shared with `behold.ts`, since a scene's ground records the same
        // acquisition the same way.
        meta: flyfotoSpecMeta(project, beholdBbox),
      };
      mutateDraft((d) => withNewSpec(d, mintDraftId(), spec));
      return true;
    },
    [user, canAdd, beholdBbox, mutateDraft, t, i18n.language],
  );

  // `Behold` over the flyfoto ground: keeps what is already on screen, with
  // nothing to propose. Picking acquisitions goes through the picker instead.
  const runFlyfoto = useCallback(
    (project?: FlyfotoProject) => {
      if (grabFlyfoto(project)) {
        toast.success({ title: t('localities.tools.flyfotoSaved') });
      }
    },
    [grabFlyfoto, t],
  );

  // `Behold` over the LiDAR ground: dataset, style, model and rectangle are
  // the whole spec, so nothing is fetched here. Into the buffer; the starter
  // set writes the identical row straight through.
  const saveExtractSpec = useCallback(
    (source: LidarSource, style: string) => {
      if (!user) return;
      const born = Date.now();
      const spec: DraftSpec = {
        kind: 'extract',
        caption: `${source.label} · ${style}`,
        sort: born,
        bornSort: born,
        hidden: false,
        meta: lidarSpecMeta(source, style, beholdBbox),
      };
      mutateDraft((d) => withNewSpec(d, mintDraftId(), spec));
    },
    [user, beholdBbox, mutateDraft],
  );

  // The duplicate guard lives here because the collection does, and it fires
  // before the tile burst rather than after it.
  const isDuplicateKey = useCallback(
    (key: BeholdKey) =>
      (attachmentItems ?? []).some((rec) =>
        attachmentMatchesKey(rec, key, beholdBbox),
      ),
    [attachmentItems, beholdBbox],
  );

  // Keeping a proposal is the one place a View is written with its pixels
  // attached: the card already rendered the figure, so storing those bytes
  // saves the pin queue a second identical tile burst.
  const keepPickerCandidate = useCallback(
    async (candidate: PickerCandidate, produced: Produced) => {
      if (!user || !canAdd) return false;
      try {
        const rec = await createAttachment(
          {
            locality: locality.id,
            kind: candidate.kind,
            caption: candidate.caption,
            meta: {
              ...candidate.meta,
              ...produced.meta,
              renderedAt: new Date().toISOString(),
            },
          },
          user.id,
          produced.blob,
          produced.filename,
        );
        setAttachmentItems((prev) => (prev ? [...prev, rec] : [rec]));
        // Written eagerly like a screenshot, compensated on `Avbryt`.
        mutateDraft((d) => withEager(d, rec.id));
        return true;
      } catch (e) {
        console.warn('[localityWorkspace] picker keep failed', e);
        toast.error({ title: t('localities.picker.keepFailed') });
        return false;
      }
    },
    [user, canAdd, locality.id, setAttachmentItems, mutateDraft, t],
  );

  const picker = usePickerRun({
    bbox4326: locality.bbox,
    subject: locality.name || undefined,
    isDuplicate: isDuplicateKey,
    onKeep: keepPickerCandidate,
  });
  const startPicker = picker.start;
  const finishPicker = picker.finish;

  // A run is a write surface and cannot outlive the stance. An effect rather
  // than a line in `standDown`, because `canAdd` can also go false without
  // either exit being pressed.
  useEffect(() => {
    if (!canAdd) finishPicker();
  }, [canAdd, finishPicker]);

  // `Hent` in the LiDAR dialog: the checked datasets × the checked styles. The
  // candidate's `meta` is the same block `saveExtractSpec` writes, so a kept
  // proposal is indistinguishable from a `Behold` or a starter-set row.
  const startLidarPicker = useCallback(
    (plans: { source: LidarSource; styles: string[] }[]) => {
      const candidates: PickerCandidate[] = [];
      for (const { source, styles } of plans) {
        // As `viewSpecOf` reads it back: 'national' or 'project:<name>'.
        const projectName = source.key.startsWith('project:')
          ? source.key.slice('project:'.length)
          : null;
        const model = source.model;
        for (const style of styles) {
          candidates.push({
            id: `${source.key}::${style}`,
            title: source.label,
            subtitle: style,
            kind: 'extract',
            caption: `${source.label} · ${style}`,
            meta: {
              sourceKey: source.key,
              sourceLabel: source.label,
              style,
              model,
              bbox25833: beholdBbox,
            },
            spec: projectName
              ? { kind: 'lidar', source: { projectName }, style, model }
              : { kind: 'lidar', source: 'national', style, model },
            key: { kind: 'lidar', sourceKey: source.key, style, model },
          });
        }
      }
      closeLidar();
      if (candidates.length > 0) startPicker('lidar', candidates);
    },
    [beholdBbox, closeLidar, startPicker],
  );

  /** `Hent` in the acquisition dialog. `null` is the seamless mosaic. */
  const startFlyfotoPicker = useCallback(
    (projects: (FlyfotoProject | null)[]) => {
      const candidates: PickerCandidate[] = projects.map((project) => {
        const label = project
          ? (project.year?.toString() ?? project.projectName)
          : t('localities.tools.flyfotoMosaic');
        return {
          id: project?.id ?? NIB_MOSAIC_KEY,
          title: label,
          subtitle: project
            ? [project.photoDate, project.projectName]
                .filter(Boolean)
                .join(' · ')
            : t('localities.tools.flyfotoMosaicHint'),
          kind: 'flyfoto',
          caption: `${t('localities.tools.flyfotoCaption')} ${
            project ? label : new Date().toLocaleDateString(i18n.language)
          }`,
          meta: {
            sourceLabel: 'Norge i bilder',
            bbox25833: beholdBbox,
            ...(project
              ? {
                  nibSource: 'project',
                  projectId: project.id,
                  projectName: project.projectName,
                  projectMetresPerPx: project.metresPerPx,
                  year: project.year,
                  photoDate: project.photoDate,
                }
              : { nibSource: 'mosaic' }),
          },
          spec: project
            ? { kind: 'flyfoto', source: { projectId: project.id } }
            : { kind: 'flyfoto', source: 'mosaic' },
          key: {
            kind: 'flyfoto',
            sourceKey: project?.id ?? NIB_MOSAIC_KEY,
            style: '',
            model: '',
          },
        };
      });
      setFlyfotoPicker(false);
      if (candidates.length > 0) startPicker('flyfoto', candidates);
    },
    [beholdBbox, startPicker, t, i18n.language],
  );

  // The starter set: one LiDAR dataset over the rectangle read three ways,
  // resolved once so the readings are comparable. `planStarterPack` decides
  // how many styles there are — the national mosaic publishes only
  // `skyggerelieff`. These writes are outside the edit transaction, so they
  // reach the pin queue at once and `Avbryt` does not take them back.
  const runStarterPack = useCallback(async () => {
    if (!user || !canAdd || starterBusy) return;
    setStarterBusy(true);
    try {
      // One cached request, and the first thing that can answer "is there any
      // laser data here at all".
      const plan = await planStarterPack(locality.bbox);
      if (!plan) {
        toast.error({ title: t('localities.tools.starterNone') });
        return;
      }

      const written: AttachmentRecord[] = [];
      for (const style of plan.styles) {
        try {
          written.push(
            await createAttachmentSpec(
              {
                locality: locality.id,
                kind: 'extract',
                caption: `${plan.source.label} · ${style}`,
                meta: {
                  sourceKey: plan.source.key,
                  sourceLabel: plan.source.label,
                  style,
                  model: plan.source.model,
                  bbox25833: beholdBbox,
                },
              },
              user.id,
            ),
          );
        } catch (e) {
          console.warn('[localityWorkspace] starter spec failed', style, e);
        }
      }

      if (written.length === 0) {
        toast.error({ title: t('localities.tools.starterFailed') });
        return;
      }
      setAttachmentItems((prev) => (prev ? [...prev, ...written] : written));
      for (const rec of written) {
        enqueuePin({
          rec,
          bbox4326: localityRef.current.bbox,
          subject: localityRef.current.name || undefined,
          onPinned: applyPinned,
        });
      }

      toast.success({
        title: t('localities.tools.starterDone', { count: written.length }),
      });
    } finally {
      setStarterBusy(false);
    }
  }, [
    user,
    canAdd,
    starterBusy,
    locality.id,
    locality.bbox,
    beholdBbox,
    setAttachmentItems,
    applyPinned,
    t,
  ]);

  // On a brand-new lokalitet the starter set runs itself. Only ever from the
  // creation sites' hand-off atom, so revisiting a lokalitet whose bilder were
  // deliberately deleted does not refill it.
  const [pendingStarter, setPendingStarter] = useAtom(
    pendingStarterLocalityIdAtom,
  );
  useEffect(() => {
    if (pendingStarter !== locality.id) return;
    // Cleared before the run, which re-triggers this effect on every write.
    setPendingStarter(null);
    void runStarterPack();
  }, [pendingStarter, locality.id, setPendingStarter, runStarterPack]);

  // `Behold`: row 1 publishes what its ground can offer, this side turns that
  // into a record. Which arm runs is decided here so there is one save path.
  const offer = useAtomValue(beholdOfferAtom);

  // The offer said as the duplicate guard's key. Null where the ground has
  // nothing to keep (Standard, Hybrid) or is not ready to say what it would
  // keep — a style list still in flight, a DEM still downloading.
  const beholdKey = useMemo((): BeholdKey | null => {
    if (!offer) return null;
    switch (offer.ground) {
      case 'lidar':
        return offer.source
          ? {
              kind: 'lidar',
              sourceKey: offer.source.key,
              style: offer.style,
              model: offer.source.model,
            }
          : null;
      case 'terreng':
        return offer.key;
      case 'flyfoto':
        return {
          kind: 'flyfoto',
          sourceKey: offer.project?.id ?? NIB_MOSAIC_KEY,
          style: '',
          model: '',
        };
      default:
        return null;
    }
  }, [offer]);

  // Hidden bilder count: concealment is curation, not deletion, so a second
  // copy of something the author put away is still a duplicate.
  const beholdDone = useMemo(() => {
    if (!beholdKey || !attachmentItems) return false;
    return attachmentItems.some((rec) =>
      attachmentMatchesKey(rec, beholdKey, beholdBbox),
    );
  }, [beholdKey, beholdBbox, attachmentItems]);

  const beholdFlyfoto = useCallback(() => {
    if (!offer || offer.ground !== 'flyfoto') return;
    void runFlyfoto(offer.project ?? undefined);
  }, [offer, runFlyfoto]);

  const behold = useCallback(() => {
    if (!user || !canAdd || !offer) return;

    // NiB's terms have to be accepted first, so this arm only raises the
    // notice and hands the work to `acceptFlyfotoNotice`.
    if (offer.ground === 'flyfoto') {
      setFlyfotoNotice('behold');
      return;
    }

    if (offer.ground === 'lidar') {
      if (!offer.source) return;
      saveExtractSpec(offer.source, offer.style);
      toast.success({ title: t('localities.tools.beholdSaved') });
      return;
    }

    if (offer.ground === 'terreng') {
      // The only arm whose render cannot be named from a dataset key: the
      // visualization and its sliders are row 1's state, so the offer carries
      // a callback instead.
      const spec = offer.describe();
      if (!spec) {
        toast.error({ title: t('localities.tools.beholdFailed') });
        return;
      }
      const born = Date.now();
      mutateDraft((d) =>
        withNewSpec(d, mintDraftId(), {
          kind: spec.kind,
          caption: spec.caption,
          meta: spec.meta,
          sort: born,
          bornSort: born,
          hidden: false,
        }),
      );
      toast.success({ title: t('localities.tools.beholdSaved') });
    }
  }, [user, canAdd, offer, saveExtractSpec, mutateDraft, t]);

  // `Oppsett`: the stack over the ground, kept as components and fades rather
  // than flattened bytes. No duplicate guard — nothing makes a scene by itself.
  const sceneCount = useMemo(
    () => (attachmentItems ?? []).filter((it) => it.kind === 'scene').length,
    [attachmentItems],
  );

  // The ground under the arrangement, gated on the group's switch because a
  // group that is off is not on the map. Standard and Hybrid answer null even
  // when it is on: there is no rectangle-fetch path for the topo WMS.
  const sceneGround = useMemo(
    () => (visningGroupShown ? sceneGroundOf(offer, beholdBbox) : null),
    [visningGroupShown, offer, beholdBbox],
  );

  const sceneShownCount =
    (visningGroupShown
      ? viewItems.filter((it) => visningShown.has(it.id)).length
      : 0) +
    (bildeGroupShown
      ? fileItems.filter((it) => bildeShown.has(it.id)).length
      : 0) +
    (sketchGroupShown
      ? sketchItems.filter((it) => sketchShown.has(it.id)).length
      : 0);

  const canKeepScene = canAdd && (sceneGround != null || sceneShownCount > 0);

  const keepScene = useCallback(() => {
    if (!user || !canKeepScene) return;

    // Bottom to top, read off the three group lists in paint order; [Skisse]
    // is last because a sketch is over both ground groups.
    const layers: SceneLayer[] = [];
    const take = (
      recs: readonly AttachmentRecord[],
      shown: ReadonlySet<string>,
      fades: ReadonlyMap<string, number>,
    ) => {
      for (const rec of recs) {
        if (shown.has(rec.id)) {
          layers.push({ id: rec.id, opacity: fades.get(rec.id) ?? 100 });
        }
      }
    };
    if (visningGroupShown) {
      take(viewItems, visningShown, store.get(visningOpacityAtom));
    }
    if (bildeGroupShown) {
      take(fileItems, bildeShown, store.get(bildeOpacityAtom));
    }
    if (sketchGroupShown) {
      take(sketchItems, sketchShown, store.get(sketchOpacityAtom));
    }

    const born = Date.now();
    mutateDraft((d) =>
      withNewSpec(d, mintDraftId(), {
        kind: 'scene',
        caption: t('localities.scene.caption', { n: sceneCount + 1 }),
        sort: born,
        bornSort: born,
        hidden: false,
        meta: sceneMetaOf({
          bbox25833: beholdBbox,
          ground: sceneGround,
          layers,
        }),
        // The same set as a relation; both halves are load-bearing.
        over: layers.map((l) => l.id),
      }),
    );
    toast.success({ title: t('localities.scene.kept') });
  }, [
    user,
    canKeepScene,
    store,
    viewItems,
    fileItems,
    sketchItems,
    visningShown,
    bildeShown,
    sketchShown,
    visningGroupShown,
    bildeGroupShown,
    sketchGroupShown,
    sceneGround,
    sceneCount,
    beholdBbox,
    mutateDraft,
    t,
  ]);

  const recreate = useSetAtom(recreateViewAtom);
  const selectVisning = useSetAtom(selectVisningAtom);

  // `Gjenskap`: a kept arrangement back on the map, the ground through
  // `recreateViewAtom`. A scene with no ground leaves the live one alone.
  // Deleted members are simply missing — the relation does not cascade.
  const restoreScene = useCallback(
    (rec: AttachmentRecord) => {
      const composition = sceneCompositionOf(rec.meta);
      if (!composition) {
        toast.error({ title: t('localities.scene.unreadable') });
        return;
      }
      const byId = new Map((attachmentItems ?? []).map((it) => [it.id, it]));

      const visning = new Set<string>();
      const bilde = new Set<string>();
      const skisse = new Set<string>();
      const fades = new Map<string, number>();
      let missing = 0;
      // A scene may name several Views while the group shows one; `layers` is
      // bottom-to-top, so the last wins and the rest are counted and reported.
      let dropped = 0;
      for (const layer of composition.layers) {
        const member = byId.get(layer.id);
        if (!member || deletedIds.has(member.id)) {
          missing++;
          continue;
        }
        fades.set(member.id, layer.opacity);
        switch (member.kind) {
          case 'extract':
          case 'flyfoto':
            dropped += visning.size;
            visning.clear();
            visning.add(member.id);
            break;
          case 'screenshot':
          case 'upload':
            bilde.add(member.id);
            break;
          case 'sketch':
            skisse.add(member.id);
            break;
          default:
            missing++;
        }
      }

      // Replaced, not merged: a member left over from what was up before is a
      // layer the scene does not contain.
      setVisningShown(visning);
      setBildeShown(bilde);
      setSketchShown(skisse);
      // The arrival guess is spent, so a later ground change cannot reach in
      // and remove a layer the scene names.
      setProvisionalView(null);
      // The fades are merged, because a member's fade outlives its member and
      // a scene has no opinion about the ones it does not include.
      const merge = (cur: ReadonlyMap<string, number>, ids: Set<string>) => {
        const next = new Map(cur);
        for (const id of ids) next.set(id, fades.get(id) ?? 100);
        return next;
      };
      setVisningOpacity((cur) => merge(cur, visning));
      setBildeOpacity((cur) => merge(cur, bilde));
      setSketchOpacityMap((cur) => merge(cur, skisse));

      // Every group on: a held-down group would show none of the members.
      setVisningGroupShown(true);
      setBildeGroupShown(true);
      setSketchGroupShown(true);

      const groundSpec = composition.ground
        ? viewSpecOf(composition.ground)
        : null;
      // The scene's own ground, not the surviving View's: hence the members
      // went on by hand above rather than through `selectVisningAtom`, which
      // also enters the View it lands on.
      if (groundSpec && groundSpec.kind !== 'scene') recreate(groundSpec);

      const notes = [
        missing > 0 ? t('localities.scene.missing', { count: missing }) : null,
        dropped > 0 ? t('localities.scene.oneView', { count: dropped }) : null,
      ].filter((n): n is string => !!n);
      if (notes.length > 0) {
        toast.warning({
          title: t('localities.scene.restored'),
          description: notes.join(' '),
        });
      } else {
        toast.success({ title: t('localities.scene.restored') });
      }
    },
    [
      attachmentItems,
      deletedIds,
      setVisningShown,
      setBildeShown,
      setSketchShown,
      setProvisionalView,
      setVisningOpacity,
      setBildeOpacity,
      setSketchOpacityMap,
      setVisningGroupShown,
      setBildeGroupShown,
      setSketchGroupShown,
      recreate,
      t,
    ],
  );

  // Pressing a card on the rail, through the pulldowns' own atoms. All three
  // shown sets are replaced rather than merged, so each stop shows one slide;
  // a card with nothing to show moves the cursor and leaves the map alone.
  // Not a toggle — pressing the selected card again would bare the ground.
  const selectBilde = useCallback(
    (id: string | null) => {
      setActiveBildeId(id);
      if (!id) return;
      const rec = (bilderItems ?? []).find((a) => a.id === id);
      if (!rec) return;
      if (rec.kind === 'scene') {
        restoreScene(rec);
        return;
      }
      // Eligibility is the pulldowns' own, so a card that can be shown here is
      // exactly a card with a switch up there.
      const visning = viewItems.some((it) => it.id === id);
      const bilde = fileItems.some((it) => it.id === id);
      const skisse = rec.kind === 'sketch' && !!rec.meta && !deletedIds.has(id);
      if (!visning && !bilde && !skisse) return;
      // A View goes through `[Visning ▾]`'s entrance rather than straight at
      // the atom, so the ground the render was made on comes back with it.
      if (visning) selectVisning(id);
      else setVisningShown(new Set<string>());
      setBildeShown(bilde ? new Set([id]) : new Set<string>());
      setSketchShown(skisse ? new Set([id]) : new Set<string>());
      setVisningGroupShown(true);
      setBildeGroupShown(true);
      setSketchGroupShown(true);
      // The arrival guess is spent, so the next ground press cannot withdraw
      // the image. `selectVisning` already does this on its own arm.
      setProvisionalView(null);
    },
    [
      bilderItems,
      viewItems,
      fileItems,
      deletedIds,
      restoreScene,
      selectVisning,
      setVisningShown,
      setBildeShown,
      setSketchShown,
      setVisningGroupShown,
      setBildeGroupShown,
      setSketchGroupShown,
      setProvisionalView,
    ],
  );

  // ←/→. Wraps, and never lands on nothing. Through `selectBilde`, so the
  // arrow keys and the pointer are the same gesture.
  const stepBilde = useCallback(
    (delta: 1 | -1) => {
      const items = bilderItems;
      if (!items || items.length === 0) return;
      const at = items.findIndex((a) => a.id === activeBildeId);
      const next =
        at < 0
          ? delta > 0
            ? 0
            : items.length - 1
          : (at + delta + items.length) % items.length;
      selectBilde(items[next].id);
    },
    [bilderItems, activeBildeId, selectBilde],
  );

  // Who may walk the rail. Both spellings gate on it — ←/→ below and A/D from
  // row 1 through `railWalkable` — so the two cannot disagree about whose the
  // strip is.
  const stripNavigable =
    stripOpen && !draftActive && (bilderItems?.length ?? 0) > 1;

  // …and not while a picker run is up. `useWorkspaceKeys` stands ←/→ down for
  // the run itself, but A/D arrive through the other listener, which knows
  // nothing about pickers, so the claim has to be made here.
  const railWalkable = stripNavigable && picker.run == null;

  // A/D reach the rail across the sibling gap, so what crosses is a delegate
  // that stays the same object while `stepBilde` under it is rebuilt on every
  // cursor move. Written in an effect, not the render body.
  const stepRef = useRef(stepBilde);
  useEffect(() => {
    stepRef.current = stepBilde;
  }, [stepBilde]);
  const stepDelegate = useCallback(
    (delta: 1 | -1) => stepRef.current(delta),
    [],
  );
  const setBilderRing = useSetAtom(bilderRingAtom);
  useEffect(() => {
    setBilderRing({ walkable: railWalkable, step: stepDelegate });
    return () => setBilderRing(null);
  }, [railWalkable, stepDelegate, setBilderRing]);

  // The NiB licensing notice. The starter set does not go through it — it
  // fetches no ortofoto.
  const openFlyfotoNotice = useCallback(() => setFlyfotoNotice('picker'), []);
  const closeFlyfotoNotice = useCallback(() => setFlyfotoNotice(null), []);
  const acceptFlyfotoNotice = useCallback(() => {
    const next = flyfotoNotice;
    setFlyfotoNotice(null);
    if (next === 'behold') beholdFlyfoto();
    else setFlyfotoPicker(true);
  }, [flyfotoNotice, beholdFlyfoto]);
  const closeFlyfotoPicker = useCallback(() => setFlyfotoPicker(false), []);

  // Fetch the acquisition list lazily, per rectangle. An effect rather than
  // the open handler, so a resize while the picker is open refetches, and a
  // list in flight is aborted when it closes.
  useEffect(() => {
    if (!flyfotoPicker || flyfotoProjects !== null) return;
    const ac = new AbortController();
    fetchFlyfotoProjectsForBbox(locality.bbox, ac.signal)
      .then((projects) => {
        if (!ac.signal.aborted) setFlyfotoProjects(projects);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        console.warn('[localityWorkspace] flyfoto project list failed', e);
        setFlyfotoProjectsError(true);
        setFlyfotoProjects([]);
      });
    return () => ac.abort();
  }, [flyfotoPicker, flyfotoProjects, locality.bbox]);

  const zoomToFunn = useCallback((id: string) => {
    const extent = getFunnExtentOnLayer(id);
    if (!extent) return;
    map.getView().fit(extent, {
      // Extra room beyond the chrome, so a small funn lands in the middle of
      // the free area rather than against an edge.
      padding: fitPadding(map, FUNN_MARGIN_PX),
      maxZoom: 19,
      duration: 400,
    });
    // `map` is a stable singleton atom value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectFunn = useCallback(
    (f: LocalityFindRecord) => {
      setSelectedFunnId(f.id);
      zoomToFunn(f.id);
    },
    [setSelectedFunnId, zoomToFunn],
  );

  const changeStatus = useCallback(
    (f: LocalityFindRecord, status: LocalityFindStatus) => {
      mutateDraft((d) => withFind(d, f.id, findBaseOf(f), { status }));
    },
    [mutateDraft],
  );

  const saveFunnMeta = useCallback(
    (f: LocalityFindRecord, title: string, note: string) => {
      mutateDraft((d) => withFind(d, f.id, findBaseOf(f), { title, note }));
    },
    [mutateDraft],
  );

  // On blur, and never to an empty title: a funn always has one.
  const commitDraftMeta = useCallback(() => {
    const rec = findItems?.find((it) => it.id === draftFunnId);
    if (!rec) return;
    const title = funnTitle.trim();
    if (title.length === 0) {
      setFunnTitle(rec.title);
      return;
    }
    if (title === rec.title) return;
    saveFunnMeta(rec, title, rec.note);
  }, [findItems, draftFunnId, funnTitle, saveFunnMeta]);

  // `Slett` on a funn is deferred: tombstoned, greyed in the list and taken
  // off the map, and `Avbryt` gives it back — hence no confirm.
  const removeFunn = useCallback(
    (f: LocalityFindRecord) => {
      // Otherwise the pen stays armed against a record on its way out.
      if (f.id === draftFunnId) stopDraft();
      mutateDraft((d) => dropFind(d, f.id));
      removeFunnFromLayer(f.id);
      if (selectedFunnId === f.id) setSelectedFunnId(null);
    },
    [draftFunnId, stopDraft, mutateDraft, selectedFunnId, setSelectedFunnId],
  );

  /** `Forkast funn`: put the pen down and take back what it made — a fresh
   *  funn is forgotten, an edited one gets `geometryBefore` put back. */
  const discardDraft = useCallback(() => {
    const id = draftFunnId;
    const rec = id ? (findItems?.find((it) => it.id === id) ?? null) : null;
    stopDraft();
    if (!id || !rec) return;
    if (draftIsEdit) {
      if (!geometryBefore) return;
      mutateDraft((d) => withFind(d, id, findBaseOf(rec), geometryBefore));
      upsertFunnOnLayer({ ...rec, ...geometryBefore });
    } else {
      mutateDraft((d) => dropFind(d, id));
      removeFunnFromLayer(id);
      if (selectedFunnId === id) setSelectedFunnId(null);
    }
  }, [
    draftIsEdit,
    draftFunnId,
    findItems,
    geometryBefore,
    stopDraft,
    mutateDraft,
    selectedFunnId,
    setSelectedFunnId,
  ]);

  useWorkspaceKeys({
    navigable: mode !== 'draft',
    draftActive,
    // All three write, so all three carry the same gate as the buttons they
    // are advertised on. N toggles, like its button.
    onNewFunn: () => canAdd && (draftActive ? stopDraft() : startDraft()),
    onToggleLidar: () => canAdd && toggleLidar(),
    onScreenshot: () => canAdd && takeScreenshot(),
    onMoveSelection: (delta) => {
      const items = findItems;
      if (!items || items.length === 0) return;
      const at = items.findIndex((f) => f.id === selectedFunnId);
      const next =
        at < 0
          ? delta > 0
            ? 0
            : items.length - 1
          : (at + delta + items.length) % items.length;
      setSelectedFunnId(items[next].id);
      // In show the funn are a tour and stepping takes the map with you; in
      // edit the view stays where it was put and Enter is what flies.
      if (stance === 'show') zoomToFunn(items[next].id);
    },
    onZoomSelected: () => selectedFunnId && zoomToFunn(selectedFunnId),
    // ←/→ walk the filmstrip, and only while there is a strip to walk:
    // OpenLayers' KeyboardPan owns these keys otherwise.
    stripNavigable,
    onStepBilde: stepBilde,

    // The picker layer stands every binding above down while a run is live.
    pickerActive: picker.run != null,
    onPickerStep: picker.step,
    onPickerKeep: () => void picker.keep(),
    onPickerDiscard: picker.discard,
    onPickerFinish: finishPicker,
    // Outside-in: the deepest thing in flight goes first, and edit leaves only
    // when the buffer is clean so a stray Escape cannot discard work.
    onEscape: () => {
      if (mode === 'lidar') closeLidar();
      else if (adjusting) undoAdjust();
      else if (selectedFunnId) setSelectedFunnId(null);
      else if (stance === 'edit') {
        if (!dirty) void exitEdit();
      } else setActiveLocality(null);
    },
  });

  const bilderCount = bilderItems?.length ?? 0;
  // Published rather than recomputed at each end, so the row's `Bilder ▾` and
  // the portal in `LocalityRibbon` cannot disagree about whether the bottom
  // edge exists.
  const hasBilder = bilderCount > 0 || starterBusy || canAdd;

  // The cover: first non-hidden, non-tombstoned image in exhibit order. Read
  // off `attachmentItems`, not `bilderItems`, so it does not change with the
  // stance.
  const coverBildeId = useMemo(
    () =>
      attachmentItems?.find((a) => !a.hidden && !deletedIds.has(a.id))?.id ??
      null,
    [attachmentItems, deletedIds],
  );

  // Lay the cover on the ground once per lokalitet, only if it is a pinned
  // View — an unpinned spec would start a WMS stitch on arrival. Two refs:
  // `useCollection` empties `items` from an effect of its own, so the first
  // pass after a swap still holds the previous lokalitet's list, and the null
  // arming the latch is what stops B spending its one shot on A's cover.
  const coverLaidRef = useRef<string | null>(null);
  const listArmedRef = useRef<string | null>(null);
  useEffect(() => {
    if (attachmentItems == null) {
      listArmedRef.current = locality.id;
      return;
    }
    if (listArmedRef.current !== locality.id) return;
    if (coverLaidRef.current === locality.id) return;
    coverLaidRef.current = locality.id;
    const cover = attachmentItems.find(
      (a) => !a.hidden && !deletedIds.has(a.id),
    );
    if (!cover) return;
    // Unconditionally, even for a cover that never reaches the ground: a strip
    // with no cursor has no detail line under it.
    setActiveBildeId(cover.id);
    if (!isPinned(cover)) return;
    if (cover.kind !== 'extract' && cover.kind !== 'flyfoto') return;
    // Written directly rather than through `selectVisningAtom`: that entrance
    // also enters the View, moving the ribbon onto a ground nobody asked for.
    setVisningShown(new Set([cover.id]));
    // Provisional, so the first ground the user asks for takes it back down.
    setProvisionalView(cover.id);
  }, [
    locality.id,
    attachmentItems,
    deletedIds,
    setVisningShown,
    setProvisionalView,
  ]);

  // Seeds Terreng's knobs: the first terrain render in exhibit order, hidden
  // ones skipped. Published as an atom because `useTerrainAnalysis` is mounted
  // from ribbon row 1, across the tree from the attachments.
  const coverTerrainSpec = useMemo(() => {
    for (const rec of attachmentItems ?? []) {
      if (rec.hidden || deletedIds.has(rec.id)) continue;
      const spec = viewSpecOf(rec);
      if (spec?.kind === 'terrain') return spec;
    }
    return null;
  }, [attachmentItems, deletedIds]);

  useEffect(() => {
    setCoverTerrainSpec(coverTerrainSpec);
    return () => setCoverTerrainSpec(null);
  }, [coverTerrainSpec, setCoverTerrainSpec]);

  // The pin queue's entrances from the UI: a job needs the rectangle and the
  // subject, and both are this hook's.
  const pinJob = useCallback(
    (rec: AttachmentRecord) => ({
      rec,
      bbox4326: locality.bbox,
      subject: locality.name || undefined,
      onPinned: applyPinned,
    }),
    [locality.bbox, locality.name, applyPinned],
  );

  const retryPin = useCallback(
    (rec: AttachmentRecord) => enqueuePin(pinJob(rec)),
    [pinJob],
  );

  const forcePin = useCallback(
    (rec: AttachmentRecord) => pinNow(pinJob(rec)),
    [pinJob],
  );

  // Retry sweep for specs whose render failed: once per record per session
  // (`pinAttempted`). Gated on `canAdd` because a pin is an update. Buffered
  // and tombstoned rows are skipped — neither has a server record to PATCH.
  useEffect(() => {
    if (!canAdd || !attachmentItems) return;
    for (const rec of attachmentItems) {
      if (isDraftId(rec.id) || deletedIds.has(rec.id)) continue;
      if (isPinned(rec) || pinAttempted(rec.id)) continue;
      if (!viewSpecOf(rec)) continue;
      enqueuePin(pinJob(rec));
    }
  }, [canAdd, attachmentItems, deletedIds, pinJob]);

  // `Rapportpakke`: the lokalitet as a zip. It packs `attachmentItems` minus
  // the hidden, the tombstoned and the buffered, and forces a pin only for
  // `canAdd` — a reader's bundle carries what is pinned and the front page
  // names the rest.
  const takeoutRunning = useRef(false);
  const runTakeout = useCallback(async () => {
    // A ref, not `takeoutProgress`: a second click in the same tick sees the
    // stale `false` this callback captured and packs the lokalitet twice.
    if (takeoutRunning.current) return;
    // Both lists are null while they load, and `?? []` would quietly pack an
    // empty exhibit and an empty funn table as though that were the record.
    if (!attachmentItems || !findItems) return;
    takeoutRunning.current = true;
    setTakeoutProgress({ stage: 'pinning', done: 0, total: 0 });
    try {
      const exhibit = attachmentItems.filter(
        (rec) => !rec.hidden && !deletedIds.has(rec.id) && !isDraftId(rec.id),
      );
      const result = await buildTakeout({
        locality,
        finds: findItems.filter((f) => !deletedIds.has(f.id)),
        bilder: exhibit,
        forcePin: canAdd ? forcePin : null,
        pinnableInEdit: mayAdd && !canAdd,
        onProgress: setTakeoutProgress,
      });
      // An anchor rather than `window.open`: a blob URL opened minutes after
      // the click is a popup and gets blocked. Revoked on a timer because
      // revoking in the same tick cancels the transfer in some browsers.
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      // Firefox ignores a click on an anchor that is not in the document.
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (result.missing > 0) {
        toast.warning({
          title: t('localities.takeout.missing', { count: result.missing }),
          description: t('localities.takeout.missingHint'),
          duration: 8000,
        });
      } else {
        toast.success({ title: t('localities.takeout.ready') });
      }
    } catch (e) {
      console.warn('[localityWorkspace] takeout failed', e);
      toast.error({ title: t('localities.takeout.failed') });
    } finally {
      takeoutRunning.current = false;
      setTakeoutProgress(null);
    }
  }, [
    attachmentItems,
    deletedIds,
    findItems,
    locality,
    canAdd,
    mayAdd,
    forcePin,
    t,
  ]);

  return {
    // identity / permissions
    locality,
    user,
    access,
    stance,
    // Permission without stance, for the row's `Rediger` slot.
    mayEdit,
    canEdit,
    canAdd,
    mode,
    close,
    enterEdit,

    // the copy
    copyPrompt,
    openCopyPrompt,
    closeCopyPrompt,
    confirmCopy,
    copyProgress,
    /** The original's name and owner, frozen at copy time. */
    derivedLabel: locality.derivedFrom
      ? locality.derivedFromLabel || null
      : null,
    openOriginal,

    rename,
    zoomToLocality,
    removeLocality,
    patchLocality,

    // the edit transaction
    saveEdit,
    cancelEdit,
    /** `Avslutt`: the only one of the three that leaves the stance. */
    exitEdit,
    saving,
    dirty,
    draftCounts: counts,
    /** When a buffer came back off disk, for the recovery banner. */
    restoredAt,
    /** `Forkast` on that banner: drops the buffer and the stance it arrived with. */
    discardRecovered: exitEdit,
    /** Something moved on the server while the buffer was open. */
    changedElsewhere,
    /** Tombstoned this session — greyed, and `restoreDeleted` puts it back. */
    deletedIds,
    restoreDeleted,

    // content
    findItems,
    // The exhibit, stance-filtered. The unfiltered list stays inside the hook:
    // it is what the ordering calls index into.
    bilderItems,
    /** Which of `bilderItems` belong to the original rather than to this copy. */
    inheritedIds,
    /** The original could not be read at all — deleted, or no longer shared. */
    originalUnavailable,
    takeBilde,
    takingBildeId: takingId,
    coverBildeId,
    bilderCount,
    hasBilder,

    // the bottom edge
    activeBildeId,
    selectBilde,
    focusBilde,
    stepBilde,
    removeBilde,
    setBildeCaption,
    setBildeHidden,
    setBildeFunn,
    placeUpload,
    unplaceUpload,
    reorderBilde,
    // the arrangement, kept and put back
    keepScene,
    canKeepScene,
    restoreScene,

    // funn list
    selectedFunnId,
    selectFunn,
    changeStatus,
    saveFunnMeta,
    startGeometryEdit,
    removeFunn,

    // funn draft
    draftActive,
    draftFunnId,
    draftIsEdit,
    funnTitle,
    setFunnTitle,
    commitDraftMeta,
    startDraft,
    stopDraft,
    discardDraft,
    /** Either kind of session, ended — for callers that do not know which. */
    putPenDown,

    // grow-to-fit
    funnOutside,
    growToFitDrawing,

    // the sketch arm of the same pen, then [Skisse] on the layer row
    sketchActive,
    startSketch,
    stopSketch,
    keepSketch,
    resumeSketch,
    sketchShown,
    toggleSketch,
    sketchItems,
    sketchOpacity,
    setSketchOpacity,
    sketchGroupShown,
    toggleSketchGroup,

    // What [Visning] and [Bilde] list. Only the lists: their switches are
    // atoms beside `map/groundOverlay.ts` and the controls read them directly.
    viewItems,
    fileItems,

    // tools
    tool,
    adjusting,
    toggleAdjusting,
    // `Juster området`'s own [Bruk] [Angre], nested inside the transaction:
    // `Avbryt` is the wrong grain for taking back one reshaping gesture.
    applyAdjust,
    undoAdjust,
    toggleLidar,
    closeLidar,
    shooting,
    takeScreenshot,
    uploading,
    uploadFile,

    // flyfoto
    flyfotoNotice: flyfotoNotice != null,
    openFlyfotoNotice,
    closeFlyfotoNotice,
    acceptFlyfotoNotice,
    flyfotoPicker,
    closeFlyfotoPicker,
    flyfotoProjects,
    flyfotoProjectsError,
    runFlyfoto,

    // The picker runs: `picker` is what `BilderPicker` renders and what the
    // key layer drives.
    picker,
    startLidarPicker,
    startFlyfotoPicker,

    // The starter set has no verb — it runs itself on a new lokalitet — but
    // the rail is empty between the catalogue lookup and the three rows.
    starterBusy,

    // The pin queue, for the cards: `retryPin` is the button on a card whose
    // render failed, `forcePin` is what `Last ned` presses and waits on.
    retryPin,
    forcePin,

    // Rapportpakke, offered in both stances: the one write in it (the forced
    // pin) is gated inside `runTakeout`.
    runTakeout,
    takeoutProgress,

    // Behold
    behold,
    // Which of the five grounds is on screen: label, tooltip and whether the
    // button is offered at all.
    beholdGround: offer?.ground ?? null,
    // Whether the ground can say what it would keep. False on Standard and
    // Hybrid, and briefly on the other three while a style list or DEM loads.
    beholdReady: beholdKey != null,
    beholdDone,
  };
};

/** What the rows, the bottom edge and the dialogs are handed. */
export type LocalityWorkspaceApi = ReturnType<typeof useLocalityWorkspace>;
