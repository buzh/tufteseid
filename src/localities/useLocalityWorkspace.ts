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
import {
  LocalityFindRecord,
  LocalityFindStatus,
} from '../api/localityFinds';
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
import {
  useLocalityAttachments,
  useLocalityFinds,
} from './useLocalityContent';
import { useLocalityDraft } from './useLocalityDraft';
import { type PickerCandidate, usePickerRun } from './usePickerRun';
import { useWorkspaceKeys } from './useWorkspaceKeys';
import { isPinned, viewSpecOf } from './viewSpec';

/**
 * What a signed-in user is to one lokalitet.
 *
 * Three values rather than a boolean because `admin` is neither of the other
 * two: PocketBase lets an admin change and delete anybody's records, but not
 * add content to them (see `canEdit` / `canAdd` below). Everyone else,
 * signed out included, is a reader.
 */
export type LocalityAccess = 'owner' | 'admin' | 'reader';

/**
 * Which of the two things you are doing inside the record — reading it, or
 * working on it (docs/lokalitet-view.md §1).
 *
 * The other axis entirely, and orthogonal to `LocalityAccess`: access is a
 * fact about the record, stance is a choice made inside it. A copy is not a
 * third stance.
 */
export type Stance = 'show' | 'edit';

/*
 * How many acquisitions one picker run will take.
 *
 * A busy area has well over a hundred — Oslo lists 121 — and the cap used to
 * be about bandwidth: "Hent alle" fetched every one of them up front. Since
 * §4.3 the run fetches one card ahead of where you are standing, so stopping
 * at the third proposal costs three tile bursts whatever the cap says.
 *
 * It stays anyway, and now it bounds the *judging* rather than the traffic:
 * a rail of 121 near-identical photographs of one valley is not a thing
 * anybody triages, and a picker you abandon halfway is worse than a shorter
 * list of the newest ones.
 */
export const FLYFOTO_BATCH_MAX = 8;

// Spacing between exhibit positions when the whole list has to be renumbered
// (§4.4, `reorderBilde`). Big enough that ten further moves fit between any
// two neighbours by halving, small enough that the values stay far below the
// epoch-millisecond keys `nextAttachmentSort` mints — which is what keeps a
// newly created bilde at the end of a hand-arranged exhibit.
const SORT_STEP = 1000;

// What the ground was, for the screenshot figure's source line. Keyed on the
// background layer rather than asked of useGroundMode, which needs the whole
// LiDAR + flyfoto control surface mounted to answer the same question.
const GROUND_LABEL_KEY: Record<BackgroundLayerName, string> = {
  // The five Standard cartographies name themselves rather than all reporting
  // "Standard": a screenshot over the 1890s amtskart and one over the current
  // topographic map are different documents, and the caption is the only place
  // the file says which it is.
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
  // Never the value of the background atom — hybrid is a modifier — but the
  // union has to be covered.
  topoOverlay: 'ribbon.mode.hybrid',
};

// Hybrid is a LiDAR stack with names on it, so it credits the same way and
// only the label differs.
const groundLabelKey = (layer: BackgroundLayerName, hybrid: boolean): string =>
  hybrid ? 'ribbon.mode.hybrid' : GROUND_LABEL_KEY[layer];

// Which grounds put Norge i bilder pixels in the frame, i.e. whose credit
// line has to name NiB as well as Kartverket.
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
 * The panel it was extracted from was one component, so its local state
 * survived only because Layout keyed it on `locality.id`. The surface is now
 * two ribbon rows, a bottom edge, a map callout, two popovers and four
 * dialogs, and holding the state in any of them would scatter it across
 * siblings — in particular the funn draft, whose pen is on the bottom edge
 * and whose title is on a ribbon row, and the flyfoto notice → picker
 * handoff, which is a four-flag conversation between two dialogs.
 *
 * Mount this **once**. `useLocalityFinds` / `useLocalityAttachments` each
 * open a PocketBase realtime subscription that reloads the whole list on
 * every event, so a second call site means N subscriptions and N reloads
 * per change.
 */
export const useLocalityWorkspace = (locality: LocalityRecord) => {
  const { t, i18n } = useTranslation();
  const map = useAtomValue(mapAtom);
  // For the handful of values that are only wanted at the instant of a click —
  // see the layer-row fades below. Reading them through the store is what
  // keeps a slider drag from re-rendering everything this hook feeds.
  const store = useStore();
  const user = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const setActiveLocality = useSetAtom(activeLocalityAtom);
  const [editingId, setEditingId] = useAtom(editingLocalityIdAtom);
  const setCoverTerrainSpec = useSetAtom(coverTerrainSpecAtom);
  // The pen: what has been asked for, what is actually up, and what is on it.
  // The request is written here; the session and the scene are the surface's
  // answer, and everything below reads them rather than a flag of its own.
  const setDrawRequested = useSetAtom(drawRequestedAtom);
  const drawSession = useAtomValue(funnSessionAtom);
  const scene = useAtomValue(funnSceneAtom);
  const draftActive = useAtomValue(funnDraftActiveAtom);
  const sketchActive = drawSession?.mode === 'sketch';
  const [sketchShown, setSketchShown] = useAtom(sketchShownAtom);
  const [sketchOpacity, setSketchOpacityMap] = useAtom(sketchOpacityAtom);
  const [sketchGroupShown, setSketchGroupShown] = useAtom(sketchGroupShownAtom);
  /*
   * The two ground groups' switches. Their controls own them (see `viewItems`
   * and `fileItems` below) and this hook's business with them is mostly
   * emptying them on the way out — except for what step 8 reads back off the
   * row: a new sketch records what it was drawn over (`over`, §13.6), and
   * `keepScene` records the whole arrangement (§13.7).
   *
   * Which is why the group switches are read and the *fades* are not. A group
   * being off means its members are not on the map, so it changes what a keep
   * would contain and the button's own enabled state with it; a fade changes
   * neither, and subscribing to it here would re-render the whole workspace
   * once per slider frame. `keepScene` reads those off the store at the
   * instant of the press instead.
   */
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
  // Read only so a screenshot can say whose pixels are in it. Both halves of
  // the compare curtain, not the focused facade: a screenshot is of the whole
  // map, so a split one has two grounds in it and — where one of them is
  // ortofoto — two rights holders.
  const background = useAtomValue(backgroundLayerHalves.a);
  const hybrid = useAtomValue(hybridOverlayHalves.a);
  const compareOn = useAtomValue(compareOnAtom);
  const backgroundB = useAtomValue(backgroundLayerHalves.b);
  const hybridB = useAtomValue(hybridOverlayHalves.b);
  // What the heritage overlay is *drawing*, not what is ticked: a screenshot
  // taken with the eye down has no heritage in its pixels, and the figure
  // caption below names what is in the pixels.
  const themeLayers = useAtomValue(shownThemeLayersAtom);
  const heritageDetails = useAtomValue(heritageDetailsAtom);
  const heritageRender = useAtomValue(heritageRenderAtom);
  const heritageOpacity = useAtomValue(heritageOpacityAtom);
  const [shooting, setShooting] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Which borrowed File is being pulled across, if any (§7). An id rather
  // than a bool because the tail can be a dozen cards long and the spinner
  // belongs on the one that was pressed.
  const [takingId, setTakingId] = useState<string | null>(null);
  // `Lag min kopi`: whether the dialog is up, and how far the fork has got.
  const [copyPrompt, setCopyPrompt] = useState(false);
  const [copyProgress, setCopyProgress] = useState<CopyProgress | null>(null);
  // `Rapportpakke`: how far the bundle has got (§9). Same shape and the same
  // banner rank as the copy's, because it is the same kind of wait — a long
  // one with a countable middle.
  const [takeoutProgress, setTakeoutProgress] =
    useState<TakeoutProgress | null>(null);
  // Whether the licensing notice is up, and what accepting it does. Two
  // routes reach NiB now — the acquisition picker and `Behold` over the
  // flyfoto ground — and consent is owed on both, so the notice grew a
  // destination rather than a second copy.
  const [flyfotoNotice, setFlyfotoNotice] = useState<
    'picker' | 'behold' | null
  >(null);
  // Whether the starter set is being written. A plain bool since §4.1.2: it
  // used to name the style being fetched, because fetching three was minutes
  // and the rail had nothing else to say — now the three cards appear almost
  // at once and each says its own pin state.
  const [starterBusy, setStarterBusy] = useState(false);
  // The acquisition picker, opened once the licensing notice is accepted.
  const [flyfotoPicker, setFlyfotoPicker] = useState(false);
  const [flyfotoProjects, setFlyfotoProjects] = useState<
    FlyfotoProject[] | null
  >(null);
  const [flyfotoProjectsError, setFlyfotoProjectsError] = useState(false);

  // What this user *is* to this record. A fact, not a choice.
  const access: LocalityAccess =
    user == null
      ? 'reader'
      : user.id === locality.owner
        ? 'owner'
        : isAdmin
          ? 'admin'
          : 'reader';

  // And what they are *doing* in it. The other axis (§1): every lokalitet
  // opens in show, and `Rediger` is the one way into the other stance.
  const stance: Stance = editingId === locality.id ? 'edit' : 'show';

  // Two permissions, not one, because the server has two.
  //
  // `mayEdit` mirrors the update and delete rules, which are the same on all
  // three collections: `owner = @request.auth.id || @request.auth.role =
  // "admin"`.
  //
  // `mayAdd` is stricter, and deliberately so. The *create* rules on `finds`
  // and `attachments` also demand `locality.owner = @request.auth.id`, so an
  // admin who pressed "Nytt funn" on somebody else's site would collect a
  // 403 after doing the work. Showing them that button is the same lie as
  // hiding Slett, pointing the other way.
  const mayEdit = access !== 'reader';
  const mayAdd = access === 'owner';

  // What the surfaces are actually handed: permission **and** stance. Folding
  // the two together here rather than at each call site is what makes §2's
  // invariant — *nothing in show writes* — hold everywhere at once, including
  // in the places nobody remembers to check. A write verb whose gate is false
  // is rendered absent, not disabled, so show mode has no write verbs at all
  // rather than a row of greyed ones.
  const canEdit = mayEdit && stance === 'edit';
  const canAdd = mayAdd && stance === 'edit';

  /*
   * The edit transaction (docs/lokalitet-view.md §5.6).
   *
   * Everything below that used to write now writes *here* instead, and
   * `Lagre` plays the buffer out to PocketBase in one pass. The exception is
   * the lokalitet's own fields, which keep going onto `activeLocalityAtom`
   * as they always did — half the app reads the rectangle off it, and a
   * buffered bbox those never saw would make "Juster området refetches the
   * DEM for free" stop being true. So `applyLocality` moves the live record
   * and the buffer keeps the copy to put back.
   */
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

  // Recovery enters edit by itself: the buffer is the session, and putting
  // it back without the stance that owns it would leave the work on screen
  // with no way to save it (§5.6, consequence 4).
  useEffect(() => {
    if (restoredAt != null) setEditingId(locality.id);
  }, [restoredAt, locality.id, setEditingId]);

  // …and the other direction. `enterEdit` opens the buffer, but it is not the
  // only way into edit: a lokalitet made in this session arrives in it
  // already, set by whichever creator made the record (§2). Stance without a
  // buffer is the one state that would lose work silently — every write is a
  // `mutateDraft`, and `mutate` is a no-op while `draft` is null — so the
  // buffer follows the stance rather than the entrance.
  //
  // Which is also how a session survives its own `Lagre` and `Avbryt`: both
  // empty the buffer without touching the stance, and this puts a fresh one
  // back. Reopening *here* rather than at the end of those two is what keeps
  // `baseLocality` honest — this runs on the render after the commit or the
  // rollback has settled, so the new buffer's base is the record as it now
  // stands rather than the one the callback closed over.
  useEffect(() => {
    if (stance === 'edit' && !draft) beginDraft();
  }, [stance, draft, beginDraft]);

  /*
   * Realtime stands down for the length of the transaction (§5.6,
   * consequence 5): the subscription stays up, but an event raises a flag
   * instead of reloading a list the buffer is describing.
   */
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

  // What every surface reads: the server's lists with the session laid over
  // them. Nothing downstream knows the difference — see `draft.ts`.
  const ownerId = user?.id ?? locality.owner;
  const findItems = useMemo(
    () => overlayFinds(serverFinds, draft, locality.id, ownerId),
    [serverFinds, draft, locality.id, ownerId],
  );
  const attachmentItems = useMemo(
    () => overlayAttachments(serverAttachments, draft, locality.id, ownerId),
    [serverAttachments, draft, locality.id, ownerId],
  );

  /*
   * The deferred deletions (§5.6, consequence 2).
   *
   * One set for both collections — PocketBase ids are unique across them —
   * because every surface that asks does so about one record at a time, and
   * two sets would only be two things to remember to check.
   */
  const deletedIds = useMemo(
    () =>
      new Set<string>([
        ...(draft?.findDeletes ?? []),
        ...(draft?.attachmentDeletes ?? []),
      ]),
    [draft],
  );

  /*
   * A figure the pin queue just landed, put on the card it belongs to.
   *
   * The queue PATCHes the record and realtime would normally carry that back
   * — but realtime is held back for the length of an edit session, and edit is
   * exactly when pins happen: the sweep runs there, and so does the starter
   * set on a lokalitet thirty seconds old. Without this the three cards the
   * author is watching stay blank until they leave the stance, which is the
   * whole complaint the write-through was for.
   *
   * Up here rather than beside the queue's other verbs because the starter set
   * enqueues before those are declared.
   */
  const applyPinned = useCallback(
    (rec: AttachmentRecord) =>
      setAttachmentItems((prev) =>
        prev ? prev.map((it) => (it.id === rec.id ? rec : it)) : prev,
      ),
    [setAttachmentItems],
  );

  /** Whether `Avbryt` has anything to throw away, and what it would name. */
  const dirty = isDirty(draft);
  const counts = useMemo(
    () => (draft ? draftCounts(draft) : null),
    [draft],
  );

  /** Take a deferred deletion back — the verb on the greyed card. */
  const restoreDeleted = useCallback(
    (id: string) => {
      mutateDraft((d) => undelete(d, id));
      const rec = findItems?.find((f) => f.id === id);
      if (rec) upsertFunnOnLayer(rec);
    },
    [mutateDraft, findItems],
  );

  /*
   * The exhibit (docs/lokalitet-view.md §4.4).
   *
   * `attachmentItems` arrives in `sort` order from the server. What the strip
   * walks is this list minus the concealed ones — in show. In edit the hidden
   * records are on the rail too, marked: concealment is one of the things you
   * are there to change, and a curation control you cannot see the effect of
   * is not one.
   *
   * That makes the *positions* differ between the two stances, which is why
   * every ordering call below indexes into `attachmentItems` and never into
   * this list: an exhibit order that depended on who was looking would not be
   * an order.
   */
  const { items: inheritedItems, unavailable: originalUnavailable } =
    useInheritedBilder(locality, serverAttachments, canAdd);

  /**
   * The borrowed tail: `derivedFrom`'s Files, which the copy did not carry
   * (§7). Publishing the ids rather than the records is what keeps every
   * ordering call below honest — those index into `attachmentItems`, which
   * has none of these in it, and the tail is a *suffix* of `bilderItems`, so
   * a position in the one is still a position in the other.
   */
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

  /*
   * Which bilde the bottom edge is pointing at (docs/lokalitet-view.md §4.3).
   *
   * Up here rather than in BilderStrip for two reasons: the strip unmounts
   * when it is folded away, and ←/→ walk it from `useWorkspaceKeys`, which is
   * mounted here.
   *
   * Since step 6 this said nothing about the map, and **that is reversed** —
   * see `selectBilde`, defined with the map verbs it now needs.
   */
  const [activeBildeId, setActiveBildeId] = useState<string | null>(null);

  // The record is no longer on the rail — deleted here or by another session,
  // or concealed and then left behind when `Ferdig` drops the stance.
  //
  // Only the cursor needs sweeping. A layer member goes with its record for
  // free: `viewItems` and `fileItems` apply the same two filters, so a record
  // that has left the rail has left the pulldown, and the `<GroundMember>`
  // under it unmounts and takes its pixels with it. The switch that outlives
  // it is an id in a set that nothing lists, which the close/swap cleanup
  // empties.
  useEffect(() => {
    if (
      activeBildeId &&
      bilderItems &&
      !bilderItems.some((a) => a.id === activeBildeId)
    ) {
      setActiveBildeId(null);
    }
  }, [activeBildeId, bilderItems]);

  /*
   * Folding the rail away used to put the ground back, and unfolding it put
   * the image back — `Bilder` as one gesture with two halves, with the card
   * under the cursor and the pin both remembered in a ref across the fold.
   *
   * Step 6 deleted the whole of it, because the whole of it was undoing
   * something this hook was doing to itself, and it stays deleted now that
   * selecting a thumbnail shows it again. What made the fold destructive was
   * that the rail was the image's *only* control, so folding it away hid the
   * switch that was holding the image up. It is not: what is on the ground is
   * the layer row's four pulldowns, which are on the row and stay on the row
   * whatever the bottom edge is doing. So there is still nothing to drop,
   * nothing to remember and nothing to give back — the cursor stays where it
   * was, the image stays up, and unfolding shows the same card selected.
   */

  /**
   * Point the rail at a record, and nothing else.
   *
   * For the surface selecting *for* you, as against `selectBilde`, which is a
   * press and therefore also changes the map. `BilderCarousel` lands on the
   * first image when edit opens, because a surface entered in order to change
   * something should not make you pick a subject before you can — and landing
   * there must not rearrange the ground on the way in.
   */
  const focusBilde = useCallback((id: string | null) => {
    setActiveBildeId(id);
  }, []);

  /*
   * …and the other direction: the cursor follows the map.
   *
   * Whenever exactly one bilde is on the map, the rail points at it. That
   * covers three gestures with one rule — W/S walking `[Visning ▾]`'s ring
   * (§5.3), a switch pressed in any of the three pulldowns, and the arrival
   * cover — none of which knows the rail exists, and all of which would
   * otherwise leave the strip pointing at some other card while the ground
   * shows this one.
   *
   * Exactly one, because that is the only arrangement a single cursor can
   * describe honestly. Two members up is a comparison and the rail stays
   * where it is; none up is the empty ground, and blanking the cursor there
   * would close the detail panel every time someone switched a group off.
   *
   * No loop with `selectBilde`: it sets the shown set to the id it just
   * pointed at, so this fires and finds the cursor already there.
   */
  useEffect(() => {
    const shown = [...visningShown, ...bildeShown, ...sketchShown];
    if (shown.length !== 1) return;
    const id = shown[0];
    // A set is never pruned (§13.4), so it can still name a record that has
    // left the rail — and the sweep above would only have to undo this.
    if (!bilderItems?.some((a) => a.id === id)) return;
    setActiveBildeId((cur) => (cur === id ? cur : id));
  }, [visningShown, bildeShown, sketchShown, bilderItems]);

  /*
   * `Slett bildet` — **not** deferred, unlike every other write in edit.
   *
   * It was, and the deferral cost more than it bought. The confirm on the
   * button already says the action cannot be undone, so the greyed card that
   * followed was contradicting it; and getting the deletion to actually
   * happen meant `Lagre`, which also ends the session — so tidying an exhibit
   * of twelve renders was twelve rounds of leaving edit and coming back. That
   * is the same reasoning `Slett lokaliteten` already runs on: a confirmed
   * deletion is a decision, not a draft.
   *
   * So the request goes out here and the buffer forgets the record entirely
   * (`forgetAttachment`). What is left is narrow and worth stating:
   *
   * - **A buffered spec never reached the server**, so there is nothing to
   *   delete — dropping it from `newSpecs` is the whole operation.
   * - **Realtime stands down in edit**, so the list will not notice on its
   *   own; `setAttachmentItems` takes the record off it.
   * - **A failure falls back to the old behaviour.** The tombstone stays, the
   *   card greys, `Angre sletting` is on it and `Lagre` retries the DELETE.
   *   That is the one path on which `deletedIds` still covers an attachment.
   *
   * The pin goes down with it either way: picking a frame lays it on the
   * ground, so the ordinary path — pick it, decide against it, press `Slett`
   * — would otherwise end with the image still on the map, named by nothing.
   */
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

  // Into the buffer, which is also what makes the drag not snap back: there
  // is no round trip to wait out any more.
  //
  // Four columns since step 9, not three: `funn` joined the curation set when
  // it stopped being something a producer knew and became something the author
  // says (§13.6). `meta` is still out of the signature, for the reason
  // `placeUpload` gives — a caption edit must never be able to carry a spec.
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

  /*
   * Which funn this bilde belongs to (§13.6, §13.10 step 9).
   *
   * One id or none, written as the whole array — "belongs to" is a single
   * answer, and `funnGroups.ts` reads it back as one. The array is what the
   * column is, so the editor writes the column rather than a convention on top
   * of it; a record that somehow held two would be corrected by the first edit
   * rather than quietly half-read.
   *
   * `canEdit` rather than `canAdd`, like the caption beside it: this is an
   * update, so an admin over somebody else's lokalitet may file their images.
   */
  const setBildeFunn = useCallback(
    (rec: AttachmentRecord, funnId: string | null) =>
      patchBilde(rec, { funn: funnId ? [funnId] : [] }),
    [patchBilde],
  );

  // Keep it, do not show it (§4.4). The alternative to this field is deleting
  // your working renders to make the exhibit tidy, and the seven you rejected
  // are the evidence that you checked.
  const setBildeHidden = useCallback(
    (rec: AttachmentRecord, hidden: boolean) => patchBilde(rec, { hidden }),
    [patchBilde],
  );

  /*
   * `Plasser i ruta` and its undo — the upload opt-in (§13.5, §13.10 step 7).
   *
   * The only write in the whole layer-row thread, and it is deliberately not
   * *on* the layer row: §13.8 says nothing in the row writes, and the switch
   * that lays a File down has to stay a switch. Giving an upload an extent is
   * a record edit of the same kind as a caption or a concealment, so it lives
   * where those live — on the card, in edit, buffered until `Lagre`.
   *
   * The whole `meta` goes in the patch, not the one key, and that is
   * `DraftAttachment.meta`'s rule rather than a choice here: PocketBase
   * replaces a JSON field wholesale, so a partial patch is a deletion of
   * everything it left out. `rec` is the overlaid record, so a second press in
   * the same session reads what the first one buffered.
   *
   * Not `patchBilde`: that one is the three curation columns, and keeping
   * `meta` out of its signature is what stops a caption edit from ever
   * carrying a spec.
   */
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
        // The aspect is the whole input, so there is no half-placement to
        // leave behind: a file whose pixels will not decode gets no rectangle.
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

  /*
   * Move a bilde to a position in the exhibit.
   *
   * `sort` is an opaque key, so the ordinary move is a *value between the two
   * new neighbours* and costs one PATCH — which matters here more than it
   * usually would, because every write comes back as a realtime event and
   * every realtime event reloads the whole list. Renumbering forty records to
   * drag one card would be forty reloads.
   *
   * The fallback is that renumber, and it is reached in exactly two
   * situations: neighbours one apart, and the first drag on a lokalitet whose
   * records all predate the field and so all carry 0. Both are self-healing —
   * once a run has been spaced out by `SORT_STEP` there is room again.
   *
   * Since step 13 both land in the buffer rather than on the server, so the
   * renumber costs nothing at all until `Lagre` — but it is still worth
   * avoiding, because at that point it becomes forty PATCHes in the commit.
   */
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
      // No room. Space the whole exhibit out again, in the order it now
      // reads, and leave it that way — the values stay far below any clock
      // reading, so the next image created still lands last.
      for (let i = 0; i < next.length; i++) {
        patchBilde(next[i], { sort: (i + 1) * SORT_STEP });
      }
    },
    [attachmentItems, patchBilde],
  );

  // Funn draft. `draftFunnId` is the record the pen is bound to — null only
  // until the first shape closes, since drawing autosaves. `draftIsEdit`
  // distinguishes the two ways in: a new funn, or "Rediger tegningen" on one
  // that already exists.
  const [draftFunnId, setDraftFunnId] = useState<string | null>(null);
  const [draftIsEdit, setDraftIsEdit] = useState(false);
  const [funnTitle, setFunnTitle] = useState('');
  /*
   * What "Rediger tegningen" started from, so `Forkast funn` can put it back.
   *
   * §5.3's second depth-2 exit used to be offered only for a *new* funn,
   * because under autosave the old shape was overwritten the moment the new
   * one closed and a button promising to restore it would have been lying.
   * Nothing is overwritten now, so the promise is keepable — but only if
   * somebody remembers what the shape was, and this is that somebody.
   */
  const [geometryBefore, setGeometryBefore] = useState<DraftFind | null>(null);
  // The autosave's flush, handed over once that hook has run further down. A
  // ref because the two halves point at each other: the hook is driven by
  // callbacks defined here (create the record, patch it), and those callbacks
  // in turn have to be able to write out whatever is still settling. The
  // unmount path above needs it for the same reason.
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
      // Keyed by find id, so the next lokalitet's funn are not in it — but a
      // set left standing would come back with *this* lokalitet and open it
      // with funn missing that its owner never switched off in this session.
      setFunnSwitchedOff(new Set());
      // The overlays belong to this lokalitet's bilder, and the next one's
      // ids are not these. Both halves: the layers come off the map and the
      // set that decides which are up is emptied.
      setSketchOverlays([]);
      setSketchShown(new Set());
      // The fades are keyed by attachment id and the group's switch is view
      // state like the stance is — neither belongs to the next lokalitet, and
      // a group left off would open it with the sketches mysteriously absent.
      setSketchOpacityMap(new Map());
      setSketchGroupShown(true);
      // [Visning]'s three, on the same grounds. The group's own switch can
      // leave the map with *no background at all* (§13.1), so a lokalitet
      // closed with it off would hand the next one a white screen.
      // `VisningControl` puts the tile layers back on unmount; this is what
      // stops a swap — which does not unmount it — from carrying the
      // arrangement across.
      setVisningShown(new Set());
      setVisningOpacity(new Map());
      setVisningGroupShown(true);
      // The latch is keyed to an id in the set just emptied, so leaving it
      // standing would arm the next lokalitet's first ground change against a
      // member that is not on the map — harmless today, and the kind of
      // harmless that stops being so the moment ids repeat.
      setProvisionalView(null);
      // [Bilde]'s three, on the first of those grounds alone: its members are
      // attachment ids and the next lokalitet's are not these. This is also
      // the sweep that used to be `usePinnedBilde`'s — one image on the ground
      // became a set, so clearing it became emptying one.
      setBildeShown(new Set());
      setBildeOpacity(new Map());
      setBildeGroupShown(true);
      // And the curtain comes down with the row that raised it
      // (docs/lokalitet-view.md §8). Sammenlign's only control moved onto the
      // lokalitet row, so leaving the lokalitet with it up would strand a
      // second live tile stack on screen with no way to close it — which is
      // Kartverket's request budget doubled, silently and indefinitely.
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

  // The funn draft used to be reset by the whole panel remounting on a
  // lokalitet swap. It no longer does, so clear it here.
  useEffect(() => {
    setDraftFunnId(null);
    setDraftIsEdit(false);
    setFunnTitle('');
    setGeometryBefore(null);
  }, [locality.id]);

  /*
   * The lokalitet's own fields: onto the live record *and* into the buffer.
   *
   * The atom write is not an optimistic update waiting for a server to
   * confirm it — there is no request. It is where the value lives until
   * `Lagre`, because that is where every other module reads it from.
   */
  const patchLocality = useCallback(
    (patch: LocalityPatch) => {
      applyLocality(patch);
      mutateDraft((d) => withLocality(d, patch));
    },
    [applyLocality, mutateDraft],
  );

  const close = useCallback(
    () => setActiveLocality(null),
    [setActiveLocality],
  );

  // `Rediger`. Costs nothing on purpose (§2): no fetch, no write, the map
  // does not move and the render does not blink — which is what lets show
  // mode be absolute about writing nothing without being in the way. All it
  // does is set the stance; the buffer follows it, above.
  const enterEdit = useCallback(() => {
    if (!mayEdit) return;
    setEditingId(locality.id);
  }, [mayEdit, locality.id, setEditingId]);

  // Stance leaves on unmount, but only if it is still *this* record's. The
  // creators set the atom in the same batch as `activeLocalityAtom`, so a
  // brand-new lokalitet's id is already in it by the time the outgoing
  // workspace's cleanup runs; clearing unconditionally would put the new
  // record straight back into show.
  useEffect(
    () => () => setEditingId((cur) => (cur === locality.id ? null : cur)),
    [locality.id, setEditingId],
  );

  /*
   * `Lag min kopi` (§7) — the reader's half of the same slot `Rediger` fills
   * for an owner, and the only escalation left in the design: it copies,
   * swaps you to the copy, and drops you in edit there. One prompt in one
   * place, rather than an "sign this over to you first?" wrapper around
   * every write path in the app.
   *
   * The prompt is not a confirmation of a risk — nothing is at risk — it is
   * where the sentence about what does and does not come along gets said, and
   * that sentence is the whole of §7 in two lines. Which is also why it
   * cannot be skipped for an empty lokalitet: a copy that silently left the
   * screenshots behind would be found out later, over the one image that
   * mattered.
   */
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
      // Straight into it, in edit — same batch, so the row never renders the
      // copy in show first. The specs it carries have no pixels yet; the pin
      // sweep in the copy's own workspace is what asks for them, which is
      // also what keeps a fork from rendering a dozen figures for somebody
      // who was only curious.
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

  /*
   * `Åpne originalen`, on the banner a copy carries (§5.7, rank 5).
   *
   * Fetched rather than assumed reachable: `derivedFrom` is
   * `cascadeDelete: false`, so the relation outlives the record it points at
   * and outlives being un-shared. That is the accepted cost of a fork, and
   * this is where it has to be said out loud instead of opening nothing.
   */
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
      // Measured, not guessed: the ribbon takes an unpredictable slice of
      // the height at the top and the bottom edge another at the bottom, and
      // centring the rectangle in the whole canvas puts it half behind
      // both.
      padding: fitPadding(map),
      maxZoom: 18,
      duration: 400,
    });
  }, [map, locality.bbox]);

  // Opening a lokalitet also grows the chrome — a second ribbon row, and the
  // filmstrip along the bottom edge — so frame the rectangle in what is left
  // rather than leaving it half behind the surfaces that just appeared.
  //
  // Keyed on the id and not the bbox on purpose: re-fitting on every bbox
  // change would fight the "Juster området" drag, which persists a new
  // rectangle after every gesture.
  useEffect(() => {
    zoomToLocality();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locality.id]);

  // The one deletion that is not deferred, because there is nothing left to
  // defer it into: the record this transaction is about is going away, so
  // the buffer goes with it rather than waiting to be offered back.
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

  // Stopping is not discarding. The funn exists in the buffer from the moment
  // the first shape closed and every change since has gone into it, so this
  // only puts the pen down: flush whatever is still settling, take the surface
  // away, and let the funn layer show the funn again.
  const stopDraft = useCallback(() => {
    flushDraftRef.current();
    setDrawRequested(null);
    hideFunnOnLayer(null);
    if (draftFunnId) {
      const rec = findItems?.find((it) => it.id === draftFunnId);
      // The flush a line ago may not have landed in state yet; the buffer's
      // own re-render puts the newer shape up a tick later.
      if (rec) upsertFunnOnLayer(rec);
    }
    setDraftFunnId(null);
    setDraftIsEdit(false);
  }, [draftFunnId, findItems, setDrawRequested]);

  /*
   * The pen up, whichever of the two it was holding.
   *
   * Everything that takes the map back — opening the extract, grabbing the
   * rectangle handles, leaving edit — has to end a drawing session, and since
   * §9.3 there are two kinds of session to end. A funn draft has a record to
   * settle and a layer to restore; a sketch has neither, so taking the surface
   * away is all of it. Callers should not have to know which is up.
   */
  const putPenDown = useCallback(() => {
    if (draftActive) stopDraft();
    else setDrawRequested(null);
  }, [draftActive, stopDraft, setDrawRequested]);

  /*
   * First finished shape → a row in the buffer.
   *
   * The autosave above this is unchanged and still fires on the same 700 ms
   * settle: what changed is where it lands. That is the shape of §5.6 — the
   * mechanism that keeps you from losing a stroke stays exactly as it was,
   * and only the destination moves from PocketBase to a draft object, so
   * "autosave suspended" costs nothing that was worth having.
   *
   * There is no undo toast any more, and it is not missed: the thing it
   * undid was a write, and there is no longer a write to undo. `Forkast
   * funn` on the row does the same job for the whole draft, and `Avbryt`
   * does it for the session.
   *
   * Title falls back to a running number rather than blocking on one being
   * typed: a funn you can rename is worth more than a funn you have to name.
   */
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

  // A lokalitet is meant to hold the whole extent of its funn. Drawing past
  // the edge is therefore worth saying — as a standing remark in the draft
  // band, not as a modal in the way of the pen.
  //
  // The extent is kept as well as compared, because `Utvid området` needs the
  // rectangle and not just the verdict. It comes from the same place the flag
  // does — the autosave, on every settle — so the two can never describe
  // different drawings, which is what growing the lokalitet to fit a shape
  // that had since been moved back inside used to look like.
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
    // The one place in the app where the size band is a refusal rather than a
    // clamp. Everywhere else the rectangle is the thing being dragged, so
    // stopping it at the ceiling is what the author asked for; here it is
    // *derived* from a drawing, and a clamped union would put the funn back
    // outside the rectangle it was grown to hold — the verb would appear to
    // have done its job and not have done it.
    if (bboxExceedsMax(grown)) {
      toast.error({
        title: t('localities.funn.growTooLarge', { max: MAX_SIDE_M }),
      });
      return;
    }
    patchLocality({ bbox: grown });
    setFunnOutside(false);
  }, [locality.bbox, patchLocality, setFunnOutside, t]);

  /*
   * What every entrance to the pen has to do before it presses it.
   *
   * Three of them — `Nytt funn`, `Rediger tegningen`, `Tegn` — and the
   * difference between them is one line each, at the end. The surface freezes
   * the map and takes the screen, so anything that also wants the map has to be
   * put down first: another drawing session, the rectangle handles, the
   * extract dialog. Terreng stays, deliberately — it is a read-only view of the
   * same rectangle and tracing what it shows is the whole reason to have it up.
   */
  const clearForPen = useCallback(() => {
    putPenDown();
    setAdjusting(false);
    setTool((cur) => (cur === 'lidar' ? null : cur));
  }, [putPenDown, setAdjusting, setTool]);

  const startDraft = useCallback(() => {
    if (!canAdd || draftActive) return;
    clearForPen();
    hideFunnOnLayer(null);
    // The `Funn` switch is a way of looking at the ground, not a way of
    // working on it: drawing with the existing funn invisible is how you end
    // up drawing the one you already have.
    //
    // The group flag only, not the per-member switches (§13.10 step 4). This
    // one can be set by a keystroke and takes *everything* away, which is the
    // hazard; switching off one named row is a deliberate statement about a
    // funn you have therefore just looked at, and clearing it here would be
    // the pen undoing a reading it was not asked about.
    setFunnHidden(false);
    setDraftFunnId(null);
    setDraftIsEdit(false);
    setFunnTitle('');
    setGeometryBefore(null);
    setDrawRequested({ mode: 'funn' });
  }, [canAdd, draftActive, clearForPen, setFunnHidden, setDrawRequested]);

  /*
   * `Rediger tegningen`: the funn's own shape, back under the pen.
   *
   * The geometry goes up as the request's `seed` and the surface converts it
   * into whatever frame it captures (`funn/geometry.ts`). Not a `resume`: a
   * funn is geometry and has never had a scene, so there is nothing registered
   * to a frame to put back — which is why the two arrive on the request as
   * different fields rather than one nullable one.
   */
  const startGeometryEdit = useCallback(
    (f: LocalityFindRecord) => {
      if (!canAdd) return;
      clearForPen();
      hideFunnOnLayer(f.id);
      setDraftFunnId(f.id);
      setDraftIsEdit(true);
      setFunnTitle(f.title);
      // What `Forkast funn` will put back, taken from the overlaid record so
      // that a second edit in the same session restores the first one's
      // result rather than the server's copy.
      setGeometryBefore(findBaseOf(f));
      setDrawRequested({ mode: 'funn', seed: f.geometry });
    },
    [canAdd, clearForPen, setDrawRequested],
  );

  /*
   * `Tegn`: the same pen, making a *layer* instead of a funn (§9.3).
   *
   * A funn is a claim about the ground — this ditch is here, at these
   * coordinates — and it is stored as geometry because that is what a claim
   * can be checked against. A sketch is a reading of an image: the mound this
   * shadow implies, the outline the hillshade nearly shows, the arrow saying
   * *look here*. Converting that to GeoJSON would be pretending it was a
   * measurement, so the strokes themselves are what is kept.
   *
   * Hence two entrances rather than a mode switch inside one. Which of the two
   * you are making is decided before the pen goes down, because it decides
   * what the surface's tools are *for*, and a control that changed the meaning
   * of everything already drawn would be the worst button in the app.
   */
  const startSketch = useCallback(() => {
    if (!canAdd || sketchActive) return;
    clearForPen();
    setDrawRequested({ mode: 'sketch' });
  }, [canAdd, sketchActive, clearForPen, setDrawRequested]);

  /**
   * `Rediger skissen`: a stored scene back under the pen, on its own frame.
   *
   * A resume, not a seed: the scene is registered to the rectangle it was
   * drawn over, and the surface flies back to that rectangle rather than
   * re-registering the strokes to wherever the map happens to be standing.
   */
  const resumeSketch = useCallback(
    (rec: AttachmentRecord) => {
      if (!canAdd) return;
      const stored = sketchSceneOf(rec.meta);
      if (!stored) {
        toast.error({ title: t('localities.sketch.unreadable') });
        return;
      }
      clearForPen();
      setDrawRequested({ mode: 'sketch', resume: { id: rec.id, scene: stored } });
    },
    [canAdd, clearForPen, setDrawRequested, t],
  );

  /** Putting the pen down without keeping anything. Also `Avbryt` on the bar. */
  const stopSketch = useCallback(
    () => setDrawRequested(null),
    [setDrawRequested],
  );

  const sketchCount = useMemo(
    () => (attachmentItems ?? []).filter((it) => it.kind === 'sketch').length,
    [attachmentItems],
  );

  /*
   * `Behold skissen` — the scene into the buffer, as a View (§4.1.2).
   *
   * A sketch is a View like an extract is: `meta` is the whole of it, the
   * figure PNG is made afterwards by the pin queue, and that is what makes it
   * something `Avbryt` can drop without deleting anything. What it stores that
   * no other View does is `frame` — the rectangle the strokes are registered
   * to — because a scene without one is a drawing of nowhere.
   *
   * The two relations are seeded from what was on screen and never asked
   * about: the funn you had selected is what the drawing is about, the bilde
   * on the ground is what it is a layer on (§9.3). Guessing is right here
   * because the alternative is a dialog between the stroke and the record, and
   * a wrong guess costs nothing — nothing cascades off either field.
   */
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
    // Refused here, with a sentence, rather than at `Lagre` — where it would
    // be one failed row among the session's writes — or silently in
    // `localStorage`, where it would be a recovery copy that is not one.
    if (sceneBytes(elements) > SCENE_BUDGET_BYTES) {
      toast.error({ title: t('localities.sketch.tooBig') });
      return;
    }
    const meta = { frame: drawSession.frame, scene: elements };
    const resumed = drawSession.resume;
    if (resumed) {
      const rec = attachmentItems?.find((it) => it.id === resumed.id);
      // Gone while it was being drawn on — deleted in another tab, or
      // tombstoned in this session's own list. Keeping it would resurrect a
      // record the author has already said goodbye to.
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
      /*
       * What this drawing is *on* — the `over` relation (§13.6).
       *
       * It used to be the pinned File, because one image on the ground was
       * all there could be. The ground is a stack now, so the honest answer
       * is every layer that was under the pen, and in the order they were in:
       * [Visning]'s members first because they are underneath, then
       * [Bilde]'s. The two sets are disjoint by `kind`, so filtering the one
       * exhibit list twice is the row's own bottom-to-top.
       *
       * The ground preset is not in it and cannot be: `over` is a relation to
       * attachments, and "the LiDAR hillshade as it was today" is not a
       * record. That gap is what `kind: 'scene'` is for, in step 8.
       */
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
      // Shown straight away. Everything else about keeping an image leaves it
      // on the rail to be looked at later; a transparent overlay that is not
      // over anything is a card of nothing, so this one goes up on the ground
      // it was just traced off.
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

  /**
   * The switch on one sketch — the card's eye, and [Skisse]'s member row.
   *
   * Two surfaces on one set rather than two states, so the rail and the row
   * can never disagree about what is on the map (§13.10 step 3).
   */
  const toggleSketch = useCallback(
    (id: string) =>
      setSketchShown((cur) => {
        const next = new Set(cur);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [setSketchShown],
  );

  /** One member's fade, 0–100 (§13.1: each member has its own opacity). */
  const setSketchOpacity = useCallback(
    (id: string, value: number) =>
      setSketchOpacityMap((cur) => new Map(cur).set(id, value)),
    [setSketchOpacityMap],
  );

  /** The group's label toggle: the whole of [Skisse] on or off the map. */
  const toggleSketchGroup = useCallback(
    () => setSketchGroupShown((cur) => !cur),
    [setSketchGroupShown],
  );

  /*
   * What [Skisse] lists. Deletions are out — a bilde awaiting `Lagre`'s
   * compensating delete is not something to offer the map — and `hidden` ones
   * are in **in edit and only there**, which is §13.8 said exactly: a hidden
   * bilde has to stay reachable from the pulldown in edit, or curation becomes
   * a way to lose your own images. In show it is out of the exhibit, and that
   * is the same rule `bilderItems` applies two hundred lines up; a row that
   * kept it would let a reader switch on an image its author put away.
   *
   * The one under the pen is out for the same reason the overlay effect skips
   * it: its strokes are on the drawing surface, so a switch for it would be a
   * switch that does nothing.
   */
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

  /*
   * What [Visning] lists, on the same rule and by the same reading of `kind`
   * (§13.1): an extract, a terrain render and a flyfoto grab are Views over
   * the lokalitet's own rectangle and belong under the ground preset. A
   * terrain render is stored as an `extract` — it has been since the kind list
   * was fixed — so two kinds cover three producers.
   *
   * Borrowed Files are not here and cannot be: `inheritedItems` is the
   * original's bytes (§7), and a File is [Bilde]'s from step 6 anyway.
   */
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

  /*
   * What [Bilde] lists (§13.1, §13.10 steps 6 and 7) — the same two filters
   * again, and two more that only a File needs.
   *
   * A File is bytes, so unlike a View it has nothing to render from — no file
   * means no member, and a `bbox25833` is what says where the bytes go. Both
   * are checked here rather than left to fail on the map, because the one
   * thing a list of switches must not contain is a switch that cannot do
   * anything. (A View is exempt from both: it can be produced from its spec,
   * over the spec's own rectangle.)
   *
   * Which is also the whole of step 7's change to this list. A screenshot has
   * always carried the extent it was taken of; an upload carries one only once
   * somebody has pressed `Plasser i ruta` on it (§13.5). So the kind test
   * widened to both Files and the `bbox25833` test — already here, already
   * doing this job — is what keeps the unplaced ones out. An upload is not a
   * second case; it is the same case arriving later.
   */
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

  /*
   * The shown sketches, onto the map (`map/sketchOverlay.ts`).
   *
   * Declared as a whole set on every change rather than added and removed one
   * at a time: hiding a card, deleting one, rolling the session back and
   * closing the lokalitet are four paths to the same map and only one of them
   * is a removal.
   *
   * The parse is cached on the `meta` object's identity, which is what stops
   * this from being an export storm. `sketchSceneOf` builds a new scene object
   * each call, and the overlay module decides whether to re-render by
   * comparing element arrays by reference — so an uncached parse would look
   * like a new drawing on every keystroke in the name field.
   *
   * **In the order [Skisse] lists them** (§13.10 step 9), which since the
   * pulldown groups by funn is no longer exhibit order. The row's one teaching
   * claim is that position means depth (§13.1), so a grouping that reordered
   * the list without reordering the paint would make the pulldown lie about
   * the map two pixels from where it says it.
   */
  const sceneCache = useRef(new WeakMap<object, SketchScene | null>());
  useEffect(() => {
    const cache = sceneCache.current;
    const overlays: SketchOverlay[] = [];
    for (const rec of orderedByFunn(attachmentItems ?? [], findItems)) {
      if (rec.kind !== 'sketch' || !rec.meta) continue;
      if (!sketchShown.has(rec.id) || deletedIds.has(rec.id)) continue;
      // The one under the pen is on the surface already; a second copy of it
      // on the map is the pre-edit strokes showing through the drawing.
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

  /*
   * `Hent → LiDAR-uttrekk`: open the source-and-style dialog.
   *
   * There is nothing to seed any more. The extract used to carry a drawable
   * sub-selection of its own, and §6 deleted it: **every image in a lokalitet
   * covers the lokalitet's rectangle**. The filmstrip's whole value is that
   * the ground does not move as you walk it, and one image over a hand-drawn
   * sub-rectangle breaks register for the entire strip.
   *
   * So the tool is now a flag and the rectangle is `locality.bbox`, like it is
   * for every other producer. The flag is still `ribbonToolAtom`, which is
   * what keeps `U`, the Escape depth and the mutual exclusion with Terreng
   * working unchanged.
   */
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

  // Terreng and the extract are the same slot, so picking one drops the
  // other; drawing is deliberately compatible with both, since terrain is a
  // read-only view of the same rectangle and tracing what it shows is the
  // whole reason to have it up.
  //
  // Both entering and leaving Terreng are row 1's job — it owns all five
  // ground modes — and arrive as a plain write to ribbonToolAtom, so the
  // slot's cleanup has to be an effect rather than something a handler here
  // does on the way in.
  useEffect(() => {
    if (tool !== 'terrain') return;
    setAdjusting(false);
  }, [tool, setAdjusting]);

  /*
   * `Juster området` — and its own little transaction inside the big one
   * (§5.3, depth 2: `[Bruk] [Angre]`).
   *
   * The pair was already on the row before this step and only one of the two
   * buttons was honest: the gesture PATCHed the record on every release, so
   * `Angre` had nothing to undo. It has now, because the rectangle the drag
   * moves is the buffered one — but `Avbryt` is the wrong grain for it. You
   * adjust the area in the middle of a session that has also kept nine
   * images, and "put the rectangle back" must not mean "throw the session
   * away". So this remembers where the rectangle started.
   */
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

  /** `Bruk`: keep where the rectangle ended up (still buffered). */
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

  // Mounts the move/resize interactions while adjustingLocalityAtom is set,
  // and reports the rectangle after every finished gesture. Into the buffer,
  // like every other write in edit.
  const onAdjustBbox = useCallback(
    (bbox: LocalityBbox) => patchLocality({ bbox }),
    [patchLocality],
  );
  useLocalityAdjust(locality, onAdjustBbox);

  const [saving, setSaving] = useState(false);

  /*
   * Putting the edit-only tools down.
   *
   * Both exits go through here, because every one of those tools is a write
   * surface: leaving the pen armed or the extract selection live in a stance
   * whose whole promise is that nothing writes would be the invariant
   * leaking through the very door that closes it.
   */
  const standDown = useCallback(() => {
    putPenDown();
    setAdjusting(false);
    setBboxBefore(null);
    closeLidar();
    setEditingId((cur) => (cur === locality.id ? null : cur));
  }, [putPenDown, setAdjusting, closeLidar, locality.id, setEditingId]);

  /**
   * `Lagre` (§5.6) — and it no longer ends the session.
   *
   * Saving and leaving used to be one press, which made the transaction's
   * only commit also its only exit: an author who wanted the last hour on the
   * server before carrying on had to save, be thrown back into show, and
   * press `Rediger` again. The three exits are orthogonal now — `Lagre` and
   * `Avbryt` are about the buffer, `Avslutt` is about the stance — so this
   * commits and hands the stance straight back. The buffer reopens by itself:
   * see the effect that keeps one open for as long as edit lasts.
   *
   * The *pixels* still go out behind it, which is the third consequence taken
   * at its word: the last step of a commit may be a tile burst that has not
   * started yet, and holding the interface shut until every pixel exists
   * would be holding it shut for a minute.
   *
   * Returns whether everything landed, because "Lagre og avslutt" in the exit
   * confirm must not leave on a commit that half-failed.
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
        // …and the lists have to be asked again, because the stance is still
        // up and realtime is still held back. The buffer the overlay was
        // reading the new funn and specs out of is empty now, so without this
        // they would be nowhere for as long as the session lasts. Safe here
        // and nowhere else: the buffer is empty because it was just played
        // out, so there is nothing left to reload underneath.
        reloadFinds();
        reloadAttachments();
      }
      /*
       * A sketch that went up on the map when it was kept is remembered by
       * the id it was kept under, and that was a draft id the commit has just
       * replaced. Without this the overlay comes off the ground on `Lagre` —
       * the record is still there, still shown, and the eye on its card reads
       * the wrong way round.
       */
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
        // The buffer now holds exactly what did not land, the exits are still
        // on the row, and pressing `Lagre` again retries precisely that
        // remainder — which is the only reading of "still in the draft" that
        // the toast can honestly make.
        toast.error({
          title: t('localities.edit.saveFailed', { count: result.failed }),
        });
      } else if (wasChangedElsewhere) {
        // Last write wins, which is acceptable for one author with two tabs.
        // Doing it silently would not be (§5.6, consequence 5).
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

  /**
   * `Avbryt` — and it does not end the session either.
   *
   * The buffer is dropped and the eagerly written Files are deleted after
   * it; the stance stays, and a fresh buffer opens behind this one. Undoing
   * an afternoon's work and leaving the record are two different decisions,
   * and `Avslutt` is the second one. The confirm that names what is being
   * thrown away lives on the row, where the count is; by the time this runs
   * the decision is made.
   */
  const cancelEdit = useCallback(async () => {
    const eager = draft?.eagerIds ?? [];
    if (eager.length > 0) {
      setAttachmentItems((prev) =>
        prev ? prev.filter((it) => !eager.includes(it.id)) : prev,
      );
    }
    // Buffered shapes, deleted funn and edited geometry all came and went on
    // the layer by hand; the server's copy is the truth again.
    refreshFunnLayer();
    const stuck = await rollbackDraft();
    if (stuck > 0) {
      toast.error({
        title: t('localities.edit.rollbackFailed', { count: stuck }),
      });
    }
  }, [draft, setAttachmentItems, rollbackDraft, t]);

  /**
   * `Avslutt`: put the edit-only tools down and leave the stance.
   *
   * The rollback rides along rather than being skipped when the buffer is
   * clean, because a clean buffer is exactly the case where it costs nothing
   * — and leaving one open in show would leave a `baseLocality` behind that
   * the record could drift away from. The dirty case is the same call: the
   * row asks first (`Forkast og avslutt`), and by the time this runs the
   * decision is made.
   */
  const exitEdit = useCallback(async () => {
    standDown();
    await cancelEdit();
  }, [standDown, cancelEdit]);

  // Capture the current view cropped to the rectangle → Bilder.
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
            // What was on the map when the shutter went. The figure caption
            // already prints this, but only into the pixels — and a caption
            // is prose. These are the same facts in the machine's copy, so
            // the record can say what a screenshot is of without OCR.
            //
            // Not enough to *restore* the view, and it is not meant to be: a
            // screenshot is a picture of other layers at a moment (labels,
            // funn, zoom, theme rendering) and no realistic amount of
            // recorded state reproduces that. See docs/lokalitet-view.md
            // §4.1.1 — this kind is a File, not a View.
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
      // Written eagerly, so the transaction owes a DELETE on `Avbryt`
      // (§5.6). The alternative is holding a multi-megabyte blob in the
      // buffer, which `localStorage` cannot take and a crash would lose.
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

  // Upload lives here rather than in the Bilder column because the same
  // verb is on the lokalitet ribbon row: two copies of the create call
  // would be two places to keep the optimistic list update right.
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
    [
      user,
      canAdd,
      uploading,
      locality.id,
      setAttachmentItems,
      mutateDraft,
      t,
    ],
  );

  /*
   * `Ta med` — pull one of the original's Files into this copy (§7).
   *
   * The one route in the app that moves bytes sideways: down from the
   * original's storage and back up into this record. Which is exactly why it
   * is a button per card instead of part of the copy — twenty megabytes an
   * image, paid once, by whoever decided the image was worth having.
   *
   * Eager and compensated, like every other File write in edit (§5.6): the
   * blob cannot live in `localStorage`, so the record lands now and `Avbryt`
   * owes it a DELETE. `meta.takenFrom` is what keeps the card from coming
   * back on the borrowed tail afterwards.
   *
   * The whole `meta` comes across, which is how §13.5's "the flag travels into
   * a copy" is already satisfied: an upload the original had placed arrives
   * here placed, and still marked as assumed. The extent means the same thing
   * on this side because a copy inherits the original's rectangle (§7).
   */
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
            // Its place in the original's arrangement comes with it. The
            // whole point of the borrowed tail is that these are the
            // author's images, and where they sat was part of the reading.
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
  // moves or is resized. Keyed on the values rather than the array, which
  // is a fresh identity on every record update.
  const bboxKey = locality.bbox.join(',');
  useEffect(() => {
    setFlyfotoProjects(null);
    setFlyfotoProjectsError(false);
  }, [bboxKey]);

  // The rectangle in the projected CRS every producer and every stored `meta`
  // works in. Up here rather than beside `Behold`, which is where it used to
  // live, because since §4.1.2 every write in this hook records it: it is the
  // "same ground?" half of the duplicate guard, and the guard now has to work
  // against specs whose pixels do not exist yet.
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

  /*
   * One grab — which since §4.1.2 is one *row*, not one stitch.
   *
   * This used to be the slowest write in the app: a burst of NiB tiles, a
   * stitch, a figure render and a multi-megabyte JPEG upload, all before the
   * card appeared. It is now a POST of a few hundred bytes naming which
   * acquisition the author wants, and `pinQueue` does the rest with nobody
   * waiting. That is what makes the batch below — up to a dozen acquisitions
   * of the same valley — a reasonable thing to offer.
   *
   * Returns whether the row was written. The batch counts those, and the
   * count now means "acquisitions kept" rather than "acquisitions that turned
   * out to have coverage" — which the picker could not know before either,
   * having no way to ask NiB without fetching.
   *
   * Since step 13 it is not even a POST: the row goes in the draft buffer and
   * is written at `Lagre`, which is also when the pin queue first hears about
   * it. That is the payoff §4.1.2 was for — a View small enough to buffer is
   * a View `Avbryt` can drop without deleting anything.
   */
  const grabFlyfoto = useCallback(
    (project?: FlyfotoProject): boolean => {
      if (!user || !canAdd) return false;
      const label = project
        ? (project.year?.toString() ?? project.projectName)
        : t('localities.tools.flyfotoMosaic');
      const born = Date.now();
      const spec: DraftSpec = {
        kind: 'flyfoto',
        // A project's own year is what makes the gallery readable as a
        // time series; the mosaic has no year, so it gets the date it was
        // grabbed instead.
        caption: `${t('localities.tools.flyfotoCaption')} ${
          project ? label : new Date().toLocaleDateString(i18n.language)
        }`,
        sort: born,
        bornSort: born,
        hidden: false,
        // The shared builder, since a scene's ground records the same
        // acquisition the same way (`behold.ts`, §13.7).
        meta: flyfotoSpecMeta(project, beholdBbox),
      };
      mutateDraft((d) => withNewSpec(d, mintDraftId(), spec));
      return true;
    },
    [user, canAdd, beholdBbox, mutateDraft, t, i18n.language],
  );

  /*
   * `Behold` over the flyfoto ground.
   *
   * The acquisition list no longer comes through here — since §4.3 picking
   * acquisitions opens a picker run instead, and nothing is written until a
   * card is kept. `Behold` is the other gesture: it keeps *what is already on
   * screen*, so there is nothing to propose and nothing to triage.
   */
  const runFlyfoto = useCallback(
    (project?: FlyfotoProject) => {
      if (grabFlyfoto(project)) {
        toast.success({ title: t('localities.tools.flyfotoSaved') });
      }
    },
    [grabFlyfoto, t],
  );

  /*
   * A LiDAR reading of this rectangle, kept as its parameters (§4.1.2).
   *
   * `Behold` over the LiDAR ground. It used to hand this a finished
   * `ExtractRaster`, i.e. a stitch that had already happened. A dataset, a
   * style, a model and the rectangle is the entire question that stitch
   * answers, so there is nothing left for the caller to fetch first: this
   * takes the `LidarSource` straight from the catalogue and writes the row.
   *
   * Into the buffer, because this one is a decision made *inside* a session —
   * the starter set writes the same row straight through, and the difference
   * is which act it belongs to rather than what the row says. Either way it
   * lands as an `extract` attachment with the same set of meta keys, so
   * nothing downstream has to know which route produced an image.
   */
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

  /*
   * The picker runs (docs/lokalitet-view.md §4.3).
   *
   * `LiDAR-uttrekk` and `Flyfoto` keep their selection dialogs and change what
   * happens *after* one: instead of every result being saved, the results open
   * a keep/discard run in the bottom slot. The dialogs below build candidates
   * and hand them over; `usePickerRun` owns the rest.
   *
   * The duplicate guard lives here because the collection does. Under §4.1.2
   * keeping is free, which removed the cost and therefore the brake — so this
   * is the brake, and it fires before the tile burst rather than after it.
   */
  const isDuplicateKey = useCallback(
    (key: BeholdKey) =>
      (attachmentItems ?? []).some((rec) =>
        attachmentMatchesKey(rec, key, beholdBbox),
      ),
    [attachmentItems, beholdBbox],
  );

  /*
   * Keeping a proposal: `createAttachment`, not `createAttachmentSpec`.
   *
   * The one place a View is written with its pixels already attached. The card
   * rendered the figure in order to be *looked at*, so keeping it stores those
   * bytes rather than asking the pin queue for a second render of identical
   * parameters — one fewer tile burst against a shared public edge, and the
   * stored pin is literally what the author judged.
   */
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
        // The pixels are the point of the gesture, so this one is written
        // eagerly like a screenshot and compensated on `Avbryt`.
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

  // A run is a write surface, so it cannot outlive the stance that allowed
  // it: leaving edit drops the picker along with the pen and the extract
  // dialog. An effect rather than a line in `standDown` because `canAdd` can
  // also go false without either exit being pressed.
  useEffect(() => {
    if (!canAdd) finishPicker();
  }, [canAdd, finishPicker]);

  /*
   * `Hent` in the LiDAR dialog: the checked datasets × the checked styles.
   *
   * The candidate's `meta` is the same block `saveExtractSpec` writes, so a
   * kept proposal is indistinguishable from one `Behold` or the starter set
   * produced — nothing downstream has to know which route an image came by.
   */
  const startLidarPicker = useCallback(
    (plans: { source: LidarSource; styles: string[] }[]) => {
      const candidates: PickerCandidate[] = [];
      for (const { source, styles } of plans) {
        // The same reading `viewSpecOf` takes off the stored meta: the source
        // key is 'national' or 'project:<name>'.
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

  /*
   * The one-press starter set: the best LiDAR dataset over the rectangle,
   * read three ways (docs/lokalitet-view.md §4.3). Three images you would
   * fetch by hand anyway, in the order you would want to look at them.
   *
   * One dataset for all three, resolved once: three readings of the same
   * acquisition are comparable, three readings of three acquisitions are
   * not. `planStarterPack` also decides how many images this is — over
   * ground no LiDAR project covers it is one, because the national mosaic
   * publishes only `skyggerelieff`.
   *
   * It used to be minutes of tile bursts, reported style by style because
   * there was that much to report. Since §4.1.2 the only slow thing left in
   * it is the catalogue lookup, and the three writes after that are three
   * small POSTs — so the whole run is over in about a second and the images
   * themselves arrive one at a time from `pinQueue`, which is where the
   * sequencing argument moved: one stitch already saturates its concurrency
   * budget against a shared public edge, so overlapping two would not finish
   * sooner.
   *
   * There is no abort any more, and that is the point rather than an
   * omission. Closing the lokalitet used to cancel a run in flight because
   * what was in flight was megabytes nobody would see; what is in flight now
   * is three rows the author will find waiting next time, and abandoning them
   * unpinned would be the worse outcome.
   *
   * **These three writes are outside the transaction**, unlike every other
   * View this hook keeps. `Opprett` already wrote the lokalitet straight
   * through — the starter set is the rest of that same act of creation, not
   * an edit made inside it — and buffering it bought nothing but three blank
   * frames on the rail with no way to fill them short of `Lagre`. Written
   * through, they reach the pin queue immediately and the rail fills with
   * pixels while the author is still typing the name. `Avbryt` therefore does
   * not take them back, for the same reason it does not un-create the
   * lokalitet.
   */
  const runStarterPack = useCallback(async () => {
    if (!user || !canAdd || starterBusy) return;
    setStarterBusy(true);
    try {
      // The catalogue lookup is the first thing that can answer "is there any
      // laser data here at all", and it costs one cached request.
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

  /*
   * …and on a brand-new lokalitet it runs itself (§4.3, §12).
   *
   * It used to be a menu item, which meant the three images most worth having
   * arrived only for the people who already knew to ask. Framing a rectangle
   * *is* the request: nothing else you would do first makes sense without
   * them on the rail.
   *
   * Only ever from the creation sites' hand-off atom, so revisiting a
   * lokalitet whose bilder were deliberately deleted does not refill it.
   */
  const [pendingStarter, setPendingStarter] = useAtom(
    pendingStarterLocalityIdAtom,
  );
  useEffect(() => {
    if (pendingStarter !== locality.id) return;
    // Cleared before the fetch rather than after: the run takes tens of
    // seconds and this effect re-runs on every image it lands.
    setPendingStarter(null);
    void runStarterPack();
  }, [pendingStarter, locality.id, setPendingStarter, runStarterPack]);

  /*
   * `Behold` — keep the ground on screen, whatever it is
   * (docs/lokalitet-view.md §4.3, and `behold.ts` for the four-ground table).
   *
   * Row 1 publishes what its ground can offer; this is the side that turns
   * that into a record. Which of the three fetches runs is decided here
   * rather than there because two of them are the calls this hook already
   * makes for the starter set and the acquisition picker — one save path,
   * one optimistic update, one set of captions.
   */
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

  // Hidden bilder count. Concealment is curation (§4.4), not deletion, and
  // fetching a second copy of something the author put away is exactly the
  // clutter the guard exists to prevent.
  const beholdDone = useMemo(() => {
    if (!beholdKey || !attachmentItems) return false;
    return attachmentItems.some((rec) =>
      attachmentMatchesKey(rec, beholdKey, beholdBbox),
    );
  }, [beholdKey, beholdBbox, attachmentItems]);

  // One image from the ortofoto ground, once the notice has been accepted.
  // Straight through `runFlyfoto`, which is now only this: the acquisition
  // dialog stopped saving per row when it started handing its rows to a
  // picker run (§4.3), so `Behold` over Flyfoto is its last caller.
  const beholdFlyfoto = useCallback(() => {
    if (!offer || offer.ground !== 'flyfoto') return;
    void runFlyfoto(offer.project ?? undefined);
  }, [offer, runFlyfoto]);

  const behold = useCallback(() => {
    if (!user || !canAdd || !offer) return;

    // Ortofoto is the one arm that cannot start with a fetch: NiB's terms
    // have to be shown and accepted first, so the button's job here is to
    // raise the notice and hand the work to `acceptFlyfotoNotice`.
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
      // The only arm that cannot say what it is showing from a dataset
      // name: eight visualizations and three sliders, all of it state row 1
      // owns, so the offer carries a callback.
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

  /*
   * `Oppsett` — the arrangement itself, kept as a record
   * (docs/lokalitet-view.md §13.7, §13.10 step 8).
   *
   * `Behold` keeps *a ground*; this keeps *the stack over it*. Until now the
   * only way to preserve a composition was `Ta skjermbilde`, which flattens it
   * to bytes and throws away every component, every fade and every parameter —
   * so a reader could see that a 1937 ortofoto had been laid over a sky-view
   * render at 40 % but could not take it apart, re-read it at a different
   * zoom, or check either half.
   *
   * It sits beside `Behold` on the lokalitet row and **not in the layer row**,
   * which is §13.8 again: nothing in the row writes. The row is where the
   * arrangement is made; keeping one is an act of authorship and belongs with
   * the other write verbs, behind the same `canAdd`.
   *
   * No duplicate guard, unlike `Behold`. The guard exists because scrubbing a
   * slider can leave forty near-identical renders; there is no gesture here
   * that produces a scene as a side effect, and two keeps of the same stack
   * are two decisions a minute apart rather than an accident.
   */
  const sceneCount = useMemo(
    () => (attachmentItems ?? []).filter((it) => it.kind === 'scene').length,
    [attachmentItems],
  );

  /*
   * The ground under the arrangement, or null where there is none to name.
   *
   * The group's switch gates it, for the same reason it gates the pixels: a
   * group that is off is not on the map. (The preset's own switch used to gate
   * it too; it is gone — the preset's row is the group's "no View" stop now,
   * and a ground that is showing is a ground worth naming whether or not a
   * View sits over part of it.) Standard and Hybrid answer null even when the
   * group is on — there is no rectangle-fetch path for the topo WMS, so the
   * honest record of a stack built over one is a stack over nothing
   * (`sceneSpec.ts`).
   */
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

    /*
     * The stack, bottom to top — the row's own left-to-right (§13.1).
     *
     * Read off the three group lists rather than off the overlay module,
     * because the order a group paints in is the order its control declared
     * (`setGroundOverlayStack`) and that is this list filtered, not a separate
     * fact. [Skisse] is last because a sketch is over both ground groups
     * (`sketchOverlay.ts`, zIndex 2).
     */
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
        // The same set, said as a relation. Neither half is derivable from the
        // other and both are load-bearing — `sceneSpec.ts` has the argument.
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

  /*
   * …and back: put a kept arrangement on the map again (§13.7).
   *
   * A read, so it is offered in both stances and to a reader, like every other
   * layer-row gesture. It is `Gjenskap` for a stack — and for the ground under
   * it that is literally true: the bottom of a scene is a `GroundSpec`, so the
   * preset goes back through `recreateViewAtom`, the same path the View row's
   * apply takes.
   *
   * What it does **not** do is blank the ground when the scene has none. A
   * scene over Standard and a scene with the preset switched off record the
   * same nothing — neither is keepable as a spec — and the map always has a
   * ground, so switching it off here would be inventing a decision the record
   * does not contain. The flatten is the one that answers on white paper,
   * where there is no live ground to show through.
   *
   * Members that have since been deleted are simply missing, which is what the
   * uncascaded relation was chosen for; the toast says how many, because a
   * restore that silently comes back smaller is a restore nobody can trust.
   */
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
      // Scenes kept while `[Visning ▾]` was multi-select can name two Views,
      // and the group shows one. `composition.layers` is bottom-to-top, so
      // the last one wins and the ones under it are dropped — said out loud
      // below, because a restore that silently comes back smaller is a
      // restore nobody can trust.
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

      // Replaced, not merged: restoring an arrangement means the map shows
      // *that* arrangement, and a member left over from what was up before it
      // is a layer the scene does not contain.
      setVisningShown(visning);
      setBildeShown(bilde);
      setSketchShown(skisse);
      // An arrangement put back by hand is the user's statement about the
      // stack, so the arrival guess is spent — whether or not the cover
      // survived into it, a later ground change must not reach in and remove a
      // layer the scene names.
      setProvisionalView(null);
      // The fades are merged, because `opacityByKey` is never pruned (§13.4):
      // a member's fade outlives its member, and a scene has no opinion about
      // the ones it does not include.
      const merge = (cur: ReadonlyMap<string, number>, ids: Set<string>) => {
        const next = new Map(cur);
        for (const id of ids) next.set(id, fades.get(id) ?? 100);
        return next;
      };
      setVisningOpacity((cur) => merge(cur, visning));
      setBildeOpacity((cur) => merge(cur, bilde));
      setSketchOpacityMap((cur) => merge(cur, skisse));

      // Every group on: a scene's members are on the map by definition, and a
      // held-down group would show none of them.
      setVisningGroupShown(true);
      setBildeGroupShown(true);
      setSketchGroupShown(true);

      const groundSpec = composition.ground
        ? viewSpecOf(composition.ground)
        : null;
      // The scene's own ground, not the surviving View's: a scene records what
      // was underneath its layers, and that is the answer even where the top
      // layer is a render of some other ground. So the members go on the map
      // by hand here rather than through `selectVisningAtom`, whose whole
      // point is that choosing a View also enters it.
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

  /*
   * Pressing a card on the rail: point at it, **and put it on the map**
   * (docs/lokalitet-view.md §13.2, §13.8).
   *
   * That reverses step 6's rule, which was "picking a frame moves the cursor
   * and nothing else", and the reversal is the whole of this change. Step 6
   * was right that the rail must not be the *only* way to put an image up —
   * one image at a time, silently refusing on the cards it could not place,
   * was too weak for a surface whose point is comparison, and the four
   * pulldowns are what fixed it. But it left the bottom edge with no map verb
   * at all, and the bottom edge is where a visitor lands and what they press
   * first: a row of thumbnails that a reader can click and watch nothing
   * happen reads as broken, whatever the row above it can do. The author
   * ordered these images for someone to walk through, and walking through
   * them has to be the first thing that works.
   *
   * Reversed, not undone. Step 6's real content survives it: the pulldowns
   * are still where several images at once, the fades and the depth order
   * live, this defers to them by *speaking* their atoms rather than keeping a
   * pin of its own, and nothing here writes to PocketBase. What comes back is
   * one line of it — a press is a map gesture again.
   *
   * **One slide at a time.** All three sets are replaced, not merged, for
   * `restoreScene`'s reason: walking a strip means each stop shows what that
   * stop is, and a screenshot left switched on from two cards ago would be
   * painting over the extract you just asked for. Building an arrangement is
   * what the pulldowns and `Oppsett` are for — and a scene, pressed here,
   * hands straight to `restoreScene`, since a scene *is* a set of layers.
   *
   * A card with nothing to show — an unpinned spec is fine, but a File with
   * no extent, or one borrowed from the original (§7) — moves the cursor and
   * leaves the map alone. Not blanks it: the reader asked to look at a card,
   * not to clear the ground, and the card says on its own face why it cannot
   * be placed.
   *
   * No toggle. Pressing the selected card again used to mean "nothing", back
   * when nothing was cheap; now it would take the image off the ground, and
   * the card most likely to be pressed twice is the cover the lokalitet opens
   * on. "Nothing on the map" is the group switches' job, one row up.
   */
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
      // Eligibility is the pulldowns' own — `viewItems` and `fileItems` are
      // the lists `[Visning ▾]` and `[Bilde ▾]` switch, so a card that can be
      // shown here is exactly a card with a switch up there.
      // (`[Skisse ▾]` builds its own list inline from `attachmentItems`, so
      // the sketch arm spells out the same two conditions: a drawing to show,
      // and not one that is on its way out.)
      const visning = viewItems.some((it) => it.id === id);
      const bilde = fileItems.some((it) => it.id === id);
      const skisse =
        rec.kind === 'sketch' && !!rec.meta && !deletedIds.has(id);
      if (!visning && !bilde && !skisse) return;
      // A View goes through `[Visning ▾]`'s own entrance rather than straight
      // at the atom, which is what makes a card and a pulldown row the same
      // gesture: the ground the render was made on comes back with it, and the
      // ribbon describes the image the reader is looking at. The rail is still
      // speaking the row's atoms and owning no map machinery of its own — that
      // is the rule step 6 left standing; the entrance is just where the rule
      // now lives.
      if (visning) selectVisning(id);
      else setVisningShown(new Set<string>());
      setBildeShown(bilde ? new Set([id]) : new Set<string>());
      setSketchShown(skisse ? new Set([id]) : new Set<string>());
      setVisningGroupShown(true);
      setBildeGroupShown(true);
      setSketchGroupShown(true);
      // Asking for an image by name is the user's statement about the stack,
      // so the arrival guess is spent and the next ground press no longer
      // reaches in to withdraw it (§10.1). `selectVisning` has already said so
      // on its own arm; this is the other two.
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

  // ←/→. Wraps, and never lands on nothing: walking a rail past its end and
  // getting an empty strip would be a worse answer than starting over. Through
  // `selectBilde`, so the arrow keys and the pointer are the same gesture —
  // two ways of walking a sequence that disagreed about whether the map comes
  // with you would be worse than either.
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

  // The NiB licensing notice. The starter set no longer goes through it: it
  // stopped fetching ortofoto, so consent to NiB's terms is no longer being
  // asked of someone who never asked for a photograph
  // (docs/lokalitet-view.md §4.3).
  const openFlyfotoNotice = useCallback(() => setFlyfotoNotice('picker'), []);
  const closeFlyfotoNotice = useCallback(() => setFlyfotoNotice(null), []);
  const acceptFlyfotoNotice = useCallback(() => {
    const next = flyfotoNotice;
    setFlyfotoNotice(null);
    if (next === 'behold') beholdFlyfoto();
    else setFlyfotoPicker(true);
  }, [flyfotoNotice, beholdFlyfoto]);
  const closeFlyfotoPicker = useCallback(() => setFlyfotoPicker(false), []);

  // Fetch the acquisition list lazily, the first time the picker is opened
  // for a given rectangle — and again if the rectangle is resized while it
  // is open, since the effect above has just cleared it. Driving it from an
  // effect rather than the open handler is what covers that second case;
  // it also aborts a list still in flight when the picker is closed.
  // Reopening is close to free either way: wmscache fronts the query.
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
      // A funn is small; give it more room than the chrome strictly needs so
      // it lands in the middle of the free area rather than against an edge.
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

  // The draft band's own title and note edit the buffered record, same as a
  // row in the list: on blur, and never to an empty title — the auto-name
  // exists precisely so a funn always has one.
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

  /*
   * `Slett` on a funn — deferred (§5.6, consequence 2).
   *
   * The record is not deleted; it is tombstoned, greyed in the list and
   * taken off the map, and `Avbryt` gives it back. Which is why this is the
   * one deletion in the app with no confirm of its own worth having: the
   * decision is not final until `Lagre`, and the row offers `Angre sletting`
   * for the whole of the session in between.
   */
  const removeFunn = useCallback(
    (f: LocalityFindRecord) => {
      // Deleting the funn the pen is bound to would leave drawing armed
      // against a record that is on its way out.
      if (f.id === draftFunnId) stopDraft();
      mutateDraft((d) => dropFind(d, f.id));
      removeFunnFromLayer(f.id);
      if (selectedFunnId === f.id) setSelectedFunnId(null);
    },
    [draftFunnId, stopDraft, mutateDraft, selectedFunnId, setSelectedFunnId],
  );

  /**
   * Depth 2's other exit (§5.3): put the pen down *and* take back what it
   * made.
   *
   * Offered for both arms since step 13, which is what the transaction bought
   * here. It used to be new-funn-only, because a geometry edit had already
   * overwritten the old shape by the time the new one closed and a button
   * promising otherwise would have been lying. Now nothing has been written
   * either way: a fresh funn is forgotten, and an edited one gets the shape
   * `startGeometryEdit` stashed put back.
   */
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
    // All three are middle-zone verbs, so all three are edit-only — a
    // keystroke that writes is still a write, and a shortcut nobody can see
    // is the easiest place for §2's invariant to spring a leak. They stay
    // gated on the same permission as the button they are advertised on.
    //
    // N is the same toggle as its button: it puts the pen down again rather
    // than doing nothing the second time.
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
      // In show, the funn are a tour: stepping through them takes the map
      // with you (§6). In edit they are things you are working on and the
      // view is where you put it, so ↑/↓ only move the selection and Enter
      // is what flies.
      if (stance === 'show') zoomToFunn(items[next].id);
    },
    onZoomSelected: () => selectedFunnId && zoomToFunn(selectedFunnId),
    // ←/→ walk the filmstrip (§4.3), and only while there is a strip to walk:
    // OpenLayers' KeyboardPan has these keys otherwise, and taking panning
    // away from a map with no images on the edge of it would be a straight
    // loss. The ground deliberately does not move as you step, which is the
    // whole trick — each press is another reading of the same rectangle, in
    // register.
    stripNavigable: stripOpen && !draftActive && (bilderItems?.length ?? 0) > 1,
    onStepBilde: stepBilde,

    // The picker layer (§4.3). It stands every binding above down while a run
    // is live, which is the keyboard saying the same thing the bottom slot
    // says: one surface, one decision.
    pickerActive: picker.run != null,
    onPickerStep: picker.step,
    onPickerKeep: () => void picker.keep(),
    onPickerDiscard: picker.discard,
    onPickerFinish: finishPicker,
    // Outside-in, the same order the row's right zone is stacked in (§5.3):
    // the deepest thing in flight goes first, and edit is a level of its own
    // above closing. Escaping out of edit rather than out of the lokalitet is
    // what keeps the key from throwing away a stance in one press.
    //
    // The edit arm is the one that changed at step 13, and it changed by
    // getting quieter: leaving edit now means committing or discarding, and
    // neither is a thing a stray Escape should decide. So it leaves only when
    // there is nothing to lose, and an author with a buffer full of work has
    // to say which of `Lagre`, `Avbryt` and `Avslutt` they meant — the key is
    // `Avslutt` and nothing else.
    onEscape: () => {
      if (mode === 'lidar') closeLidar();
      else if (adjusting) undoAdjust();
      else if (selectedFunnId) setSelectedFunnId(null);
      else if (stance === 'edit') {
        if (!dirty) void exitEdit();
      } else setActiveLocality(null);
    },
  });

  // What the badge on `Bilder ▾` counts: the strip's own list, so a reader is
  // told how many images the exhibit has rather than how many exist. In edit
  // the hidden ones are on the rail, so they are in the count too — the number
  // and the rail always agree about what you are about to open.
  const bilderCount = bilderItems?.length ?? 0;
  // Whether the bottom edge has anything to be. Published rather than
  // recomputed at each end, so the row's `Bilder ▾` and the portal in
  // `LocalityRibbon` cannot disagree about whether pressing it does anything.
  //
  // `canAdd` is in it because an empty lokalitet you may add to still wants
  // the edge — that is where the empty line saying so goes, and where the
  // first image will land. An empty one you may *not* add to gets no bar: a
  // reader has no use for a strip that says "run an extract".
  const hasBilder = bilderCount > 0 || starterBusy || canAdd;

  /*
   * The cover (§4.4): the first non-hidden image in exhibit order.
   *
   * Derived, never stored, for the same reason the centre coordinate is not a
   * field — a `cover` relation and a `sort` column can disagree, and then the
   * exhibit has two first images. Dragging a frame to the front is what makes
   * it the cover; there is no separate verb.
   *
   * Read off `attachmentItems` rather than `bilderItems` because the answer
   * must not depend on who is looking: in edit the rail shows the hidden ones,
   * and a cover that changed when you pressed Rediger would be a different
   * lokalitet's cover.
   *
   * A card tombstoned this session is skipped even though it is still on the
   * rail: the greying says it is leaving, and letting it stay the face of the
   * lokalitet until `Lagre` would say the opposite.
   */
  const coverBildeId = useMemo(
    () =>
      attachmentItems?.find((a) => !a.hidden && !deletedIds.has(a.id))?.id ??
      null,
    [attachmentItems, deletedIds],
  );

  /*
   * And the cover, on the ground, once — the answer to "I opened a lokalitet
   * and its images were nowhere" (§13.10 step 5 left the map bare on arrival).
   *
   * The argument for opening with `visningShownAtom` empty was that switching
   * a View on can start a WMS stitch, and that is true of an *unpinned* one:
   * a spec renders itself live. A pinned one is a single file fetch and a
   * decode. So the rule is the narrow one the cost allows — the cover, and
   * only if it is a View and only if it already has its figure — and a
   * lokalitet whose first image is a screenshot, or whose extracts are still
   * in the pin queue, still opens on bare ground.
   *
   * The cover rather than all of them: it is the first non-hidden image in
   * exhibit order, i.e. the one its author dragged to the front, and N
   * stacked images is a pile nobody composed.
   *
   * Once per lokalitet, latched on the id, so it is an *arrival* and never
   * something that reaches over the user's hand afterwards — neither when the
   * pin queue lands a figure nor when curation moves the cover.
   *
   * Two refs rather than one, and the second is not optional: `useCollection`
   * empties `items` from an effect of its own, so the first effect pass after
   * a swap still holds the *previous* lokalitet's list. Latching there would
   * read A's cover for B, or — where A had no images — spend B's one shot on
   * an empty list. So the null is what arms the latch: a list is this
   * lokalitet's only once we have seen it not be the last one's.
   */
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
    // The rail starts on it too, and starts there whatever the cover turns
    // out to be: a strip with no cursor has no detail line under it, so a
    // lokalitet whose first image is a screenshot would open with its bottom
    // edge saying nothing about the image it is showing you first. Where the
    // cover *does* reach the ground, the sync effect above would land the
    // cursor here anyway — this is the case it cannot cover.
    setActiveBildeId(cover.id);
    if (!isPinned(cover)) return;
    if (cover.kind !== 'extract' && cover.kind !== 'flyfoto') return;
    // Written directly rather than through `selectVisningAtom`, and this is
    // the one place that is right: the group's entrance also *enters* the View
    // (§10.1), and an arrival that moved the ribbon onto a ground nobody asked
    // for would be the app making a guess it then has to be talked out of.
    // Lay the pixels down, leave the controls alone.
    setVisningShown(new Set([cover.id]));
    // And it is only a guess until the user has said otherwise: the first
    // ground they ask for takes it back down, because an opaque image over the
    // whole rectangle is exactly what a ground button has to be able to change
    // (`provisionalViewAtom`).
    setProvisionalView(cover.id);
  }, [
    locality.id,
    attachmentItems,
    deletedIds,
    setVisningShown,
    setProvisionalView,
  ]);

  // The site's own terrain render, for §4.6 — entering Terreng over a
  // lokalitet starts from what its owner was looking at rather than from a
  // default hillshade at 315°/35°.
  //
  // Not `coverBildeId`: the cover is usually the extract, and a lokalitet
  // whose first image is a flyfoto still has knobs worth seeding from. So this
  // is the *first terrain render* in exhibit order, hidden ones skipped —
  // curation moves it the same way it moves the cover, which is the property
  // that matters. Published as an atom because `useTerrainAnalysis` is mounted
  // from row 1, on the far side of the tree from the hook that holds the
  // attachments.
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

  /*
   * The pin queue's three entrances from the UI (§4.1.2).
   *
   * A job needs the rectangle and the subject, and both are this hook's — so
   * the cards get verbs rather than the module, and no surface has to know
   * that a pin is anything but "press this".
   */
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

  /*
   * …and the sweep: unpinned Views this session has not yet offered the queue.
   *
   * A spec whose render failed — the tile burst timed out, the tab was closed
   * mid-queue — stays a spec, and nothing would ever ask again. So opening the
   * lokalitet asks, once per record per session (`pinAttempted`), which is the
   * cheapest possible version of "retry when the queue fails" (§5.6).
   *
   * Gated on `canAdd`, and that is §2 being taken literally rather than
   * caution: a pin is an `update`, an admin may make one and a reader may not,
   * and *nothing in show writes*. So a reader sees the card say the image has
   * not been fetched, and an owner materialises it by pressing `Rediger` — the
   * same gate as every other write in this hook. It also means the sweep can
   * never fire on the public lokalitet you are only passing through.
   *
   * Buffered specs are skipped, and so are tombstoned ones: neither has a
   * record on the server to PATCH a figure onto. The specs this session made
   * reach the queue from `saveEdit`, once they do.
   */
  useEffect(() => {
    if (!canAdd || !attachmentItems) return;
    for (const rec of attachmentItems) {
      if (isDraftId(rec.id) || deletedIds.has(rec.id)) continue;
      if (isPinned(rec) || pinAttempted(rec.id)) continue;
      if (!viewSpecOf(rec)) continue;
      enqueuePin(pinJob(rec));
    }
  }, [canAdd, attachmentItems, deletedIds, pinJob]);

  /*
   * `Rapportpakke` — the whole lokalitet as a zip (§9).
   *
   * The exhibit it packs is `attachmentItems` minus the three things that are
   * not in the record: the concealed (curation is what `hidden` is for, and a
   * bundle that ignored it would ignore the author's own edit), the
   * tombstoned, and the buffered. A draft spec has no server row to pin a
   * figure onto, so `Lagre` is what puts this session's images in the report
   * — the same sentence `Last ned` already makes on a card (§5.6).
   *
   * `forcePin` goes in only for `canAdd`. A pin is an `update` and nothing in
   * show writes (§2), so a reader's bundle carries what is already pinned and
   * the front page names the rest. That is the version of "refuses to produce
   * a partial zip silently" that does not also refuse a reader a report.
   */
  const takeoutRunning = useRef(false);
  const runTakeout = useCallback(async () => {
    /*
     * A ref rather than `takeoutProgress`: the state is what the banner reads,
     * but a second click in the same tick as the first sees the stale `false`
     * captured by this callback and packs the lokalitet twice. The ref is
     * written synchronously, so the guard holds before React has re-rendered.
     */
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
      // An anchor rather than `window.open`: a blob URL opened in a tab
      // minutes after the click that asked for it is a popup and gets
      // blocked, while a download attribute is a download. The URL is
      // revoked on a timer because revoking it in the same tick cancels the
      // transfer in some browsers.
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
    // Permission alone, for the one decision that is about what you *could*
    // do rather than what you are doing: which button the row's `Rediger`
    // slot holds.
    mayEdit,
    canEdit,
    canAdd,
    mode,
    close,
    enterEdit,

    /*
     * The copy (§7) — the reader's way in, and the two things a copy knows
     * about where it came from.
     */
    copyPrompt,
    openCopyPrompt,
    closeCopyPrompt,
    confirmCopy,
    /** Non-null while the fork is being written: the banner's rank 2. */
    copyProgress,
    /** The original's name and owner, frozen at copy time — banner rank 5. */
    derivedLabel: locality.derivedFrom
      ? locality.derivedFromLabel || null
      : null,
    openOriginal,

    rename,
    zoomToLocality,
    removeLocality,
    patchLocality,

    /*
     * The transaction (§5.6). `Lagre` and `Avbryt`, and what the row needs to
     * ask before the second one: whether there is anything to lose and how
     * much of it there is.
     */
    saveEdit,
    cancelEdit,
    /** `Avslutt`: the stance verb, and the only one of the three that leaves. */
    exitEdit,
    saving,
    dirty,
    draftCounts: counts,
    /** When a buffer came back off disk, for the recovery banner (§5.7). */
    restoredAt,
    /**
     * `Forkast` on that banner: drop it and leave edit, nothing to confirm.
     *
     * `exitEdit` rather than `cancelEdit`, which is the one place the two
     * still differ in the old way: the stance was not asked for here — it came
     * with the recovered buffer — so throwing the buffer away should hand it
     * back too.
     */
    discardRecovered: exitEdit,
    /** Something moved on the server while the buffer was open (§5.6). */
    changedElsewhere,
    /** Tombstoned this session — greyed, and `restoreDeleted` puts it back. */
    deletedIds,
    restoreDeleted,

    // content
    findItems,
    // The exhibit, stance-filtered. The unfiltered list stays inside the hook:
    // it is what the ordering calls index into, and publishing both would be
    // publishing two answers to "which images does this lokalitet have".
    bilderItems,
    /*
     * The borrowed tail (§7): which of `bilderItems` belong to the original
     * rather than to this copy. A set rather than a second list, because the
     * carousel walks one rail and only needs to know which verbs a card gets
     * — and because appending them made `bilderItems` a superset of the
     * exhibit rather than a different list.
     */
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
    /** Which funn it belongs to (§13.6) — the relation's editor, at last. */
    setBildeFunn,
    placeUpload,
    unplaceUpload,
    reorderBilde,
    // the arrangement, kept and put back (§13.7)
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

    /*
     * The sketch arm of the same pen (§9.3).
     *
     * `sketchActive` is read off the session rather than a flag of its own, so
     * it is true exactly while the surface is up — which is what the exits
     * zone needs, since `Behold skissen` and `Avbryt` are the only way out of
     * a frozen map.
     *
     * `sketchShown` is a set, not a slot: two readings of the same mound,
     * traced off two different grounds, shown together over either, is the
     * analysis the whole feature is for.
     *
     * The last four are [Skisse] on the layer row (§13.10 step 3): what the
     * group lists, how far each member is faded, and the group's own switch.
     * None of them writes — the whole row is a read, in both stances (§13.8).
     */
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

    /**
     * What [Visning] lists (§13.10 step 5). Only the list: the group's four
     * switches are atoms beside the mechanism they drive
     * (`map/groundOverlay.ts`) and `VisningControl` reads them directly,
     * because unlike [Skisse] — whose set is pressed from the card's eye as
     * well — nothing outside the pulldown touches them.
     */
    viewItems,
    /**
     * What [Bilde] lists (§13.10 step 6) — the Files that can lie on the
     * ground. Published for the same reason `viewItems` is and gated the same
     * way; the group's three switches are atoms beside the mechanism.
     */
    fileItems,

    // tools
    tool,
    adjusting,
    toggleAdjusting,
    // `Juster området`'s own [Bruk] [Angre] (§5.3, depth 2). Nested inside
    // the transaction rather than leaning on it: you reshape the rectangle
    // in the middle of a session, and `Avbryt` is the wrong grain for taking
    // back one gesture.
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

    // The picker runs (§4.3). The two dialogs above start one; `picker` is
    // what `BilderPicker` renders and what the key layer drives.
    picker,
    startLidarPicker,
    startFlyfotoPicker,

    // the starter set. No verb: it runs itself on a new lokalitet now, and
    // this is here because the rail has a moment — between the catalogue
    // lookup and the three rows landing — with nothing on it yet.
    starterBusy,

    // The pin queue (§4.1.2), for the cards. `retryPin` is the button on a
    // card whose render failed; `forcePin` is what `Last ned` presses, and
    // the only caller that waits.
    retryPin,
    forcePin,

    /*
     * The Rapportpakke (§9): the verb, and how far it has got. Both stances
     * and every access level — a bundle is a read, and the one thing in it
     * that writes (the forced pin) is gated inside `runTakeout`.
     */
    runTakeout,
    takeoutProgress,

    // Behold
    behold,
    // Which of the five grounds is on screen — the button's label, its
    // tooltip and whether it is offered at all all read this.
    beholdGround: offer?.ground ?? null,
    // The ground can say what it would keep. False on Standard and Hybrid,
    // and briefly false on the other three while a style list or a DEM is
    // still in flight.
    beholdReady: beholdKey != null,
    beholdDone,
  };
};

// What the rows, the bottom edge and the dialogs are handed. Derived
// from the hook rather than declared, so adding a member to the return above
// is all it takes to make it available to every consumer.
export type LocalityWorkspaceApi = ReturnType<typeof useLocalityWorkspace>;
