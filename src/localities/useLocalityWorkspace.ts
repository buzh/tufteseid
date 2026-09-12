import type { FeatureCollection } from 'geojson';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AttachmentRecord,
  createAttachment,
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
import { useDrawSettings } from '../draw/drawControls/hooks/drawSettings';
import { getDrawLayer } from '../draw/drawControls/hooks/mapLayers';
import { renderFigureBlob } from '../figure/figure';
import { describeHeritageRender, screenshotFigure } from '../figure/specs';
import type { LidarSource } from '../lidarExtract/sources';
import { mapAtom } from '../map/atoms';
import { groundOverlayOwner } from '../map/groundOverlay';
import { activeThemeLayersAtom } from '../map/layers/atoms';
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
import { fitPadding } from '../shell/chromeInsets';
import { toast } from '../ui';
import {
  activeLocalityAtom,
  adjustingLocalityAtom,
  coverTerrainSpecAtom,
  editingLocalityIdAtom,
  funnDraftActiveAtom,
  funnHiddenAtom,
  pendingStarterLocalityIdAtom,
  selectedFunnIdAtom,
} from './atoms';
import {
  attachmentMatchesKey,
  type BeholdKey,
  beholdOfferAtom,
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
import {
  getFunnExtentOnLayer,
  hideFunnOnLayer,
  refreshFunnLayer,
  removeFunnFromLayer,
  upsertFunnOnLayer,
} from './funnLayer';
import {
  removeLocalityFromLayer,
  setLocalityHighlight,
  upsertLocalityOnLayer,
} from './localityLayer';
import { enqueuePin, pinAttempted, pinNow, type Produced } from './pinQueue';
import { captureLocalityScreenshot } from './screenshot';
import { getDrawLayerExtent4326 } from './serializeDrawLayer';
import { planStarterPack } from './starterPack';
import {
  bilderStripOpenAtom,
  funnOutsideAtom,
  ribbonToolAtom,
  workspaceModeAtom,
} from './toolAtoms';
import { useFunnAutosave } from './useFunnAutosave';
import { useInheritedBilder } from './useInheritedBilder';
import { useLocalityAdjust } from './useLocalityAdjust';
import {
  useLocalityAttachments,
  useLocalityFinds,
} from './useLocalityContent';
import { useLocalityDraft } from './useLocalityDraft';
import { type PickerCandidate, usePickerRun } from './usePickerRun';
import { canPinBilde, usePinnedBilde } from './usePinnedBilde';
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

// Extra breathing room when framing a single funn, on top of the chrome.
const FUNN_MARGIN_PX = 90;

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
  const user = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const setActiveLocality = useSetAtom(activeLocalityAtom);
  const [editingId, setEditingId] = useAtom(editingLocalityIdAtom);
  const setCoverTerrainSpec = useSetAtom(coverTerrainSpecAtom);
  const [draftActive, setDraftActive] = useAtom(funnDraftActiveAtom);
  const [adjusting, setAdjusting] = useAtom(adjustingLocalityAtom);
  const [selectedFunnId, setSelectedFunnId] = useAtom(selectedFunnIdAtom);
  const setFunnHidden = useSetAtom(funnHiddenAtom);
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
  const themeLayers = useAtomValue(activeThemeLayersAtom);
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
  const { setDrawLayerFeatures } = useDrawSettings();

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
  useEffect(() => {
    if (stance === 'edit') beginDraft();
  }, [stance, beginDraft]);

  /*
   * Realtime stands down for the length of the transaction (§5.6,
   * consequence 5): the subscription stays up, but an event raises a flag
   * instead of reloading a list the buffer is describing.
   */
  const { items: serverFinds, changedElsewhere: findsChanged } =
    useLocalityFinds(locality.id, stance === 'edit');
  const {
    items: serverAttachments,
    setItems: setAttachmentItems,
    changedElsewhere: attachmentsChanged,
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

  // "Vis i ruta". Mounted here rather than in the strip because the strip is
  // collapsible and unmounts when it is folded away — and folding it away to
  // look at the map is exactly what you do after putting an image on it.
  const pinned = usePinnedBilde(attachmentItems);
  const { pin, pinnedId } = pinned;

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
   * mounted here. It is deliberately *not* the same value as `pinned.pinnedId`
   * — an upload carries no extent and so can be the active card without being
   * on the ground, and Terreng taking the overlay slot drops the pin while
   * leaving the card where it was.
   */
  const [activeBildeId, setActiveBildeId] = useState<string | null>(null);

  // The record is no longer on the rail — deleted here or by another session,
  // or concealed and then left behind when `Ferdig` drops the stance.
  //
  // The pin goes down with it. `usePinnedBilde` only unpins records that have
  // left the *unfiltered* list, which is the right rule for a deletion and the
  // wrong one for a concealment: hiding an image and pressing Ferdig would
  // otherwise leave it lying on the map in show, which is precisely what
  // `hidden` was asked to prevent.
  useEffect(() => {
    if (
      activeBildeId &&
      bilderItems &&
      !bilderItems.some((a) => a.id === activeBildeId)
    ) {
      setActiveBildeId(null);
      pin(null);
    }
  }, [activeBildeId, bilderItems, pin]);

  /*
   * Folding the rail away puts the ground back; unfolding it puts the image
   * back. `Bilder` is one gesture with two halves, not a switch that discards.
   *
   * The fold half first. `Bilder` could be pressed shut while a 1937 ortofoto
   * stayed over the hillshade with nothing left on screen that named it or
   * could take it off — an overlay whose only controls have been folded away
   * is stranded, and you are looking at a map that is not the map. So the pin
   * goes down, and the *cursor* goes down with it: reopening onto a
   * still-selected card that is no longer on the ground makes the obvious next
   * press — click the frame to get it back — mean *deselect*, because that is
   * what `selectBilde` does to the active id.
   *
   * Which is exactly why what went down is remembered. Folding the edge away
   * is how you look at the ground under an image — a glance, like the funn eye
   * and the ground peek — and a glance that costs you your place is a glance
   * you stop taking. Unfolding puts the same card back under the cursor and
   * the same image back on the map.
   *
   * In the ref rather than in state: nothing renders it, it is read exactly
   * once, and putting it in state would re-render the whole workspace to
   * record something that has just left the screen. It dies with the hook,
   * which is remount-per-record, so a remembered id is always this
   * lokalitet's; one deleted in the meantime is cleared by the sweep above
   * and by `usePinnedBilde`'s own, so neither half needs to re-validate.
   *
   * **The restore yields the ground slot.** There is one (map/groundOverlay.ts)
   * and Terreng is the other contender, so a rail unfolded while a terrain
   * render is up must not knock it down: pinning is a press, and unfolding is
   * not a press on this image. The card comes back either way — the selection
   * is the rail's own business — and `Vis i ruta` in the detail panel is then
   * the press that takes the slot, which is the same escalation the arbiter
   * asks of every other caller.
   *
   * Only an explicit fold, which is why this reads `stripOpen` rather than
   * whether the strip is mounted: the pen and a picker borrow the bottom slot
   * (LocalityRibbon), and drawing a funn over a pinned ortofoto is a use of
   * this feature, not a lapse in it.
   */
  const foldedRef = useRef<{ active: string | null; pinned: string | null }>({
    active: null,
    pinned: null,
  });
  const stripWasOpen = useRef(stripOpen);
  useEffect(() => {
    if (stripOpen === stripWasOpen.current) return;
    stripWasOpen.current = stripOpen;

    if (!stripOpen) {
      foldedRef.current = { active: activeBildeId, pinned: pinnedId };
      setActiveBildeId(null);
      pin(null);
      return;
    }

    const { active, pinned: wasPinned } = foldedRef.current;
    foldedRef.current = { active: null, pinned: null };
    if (active) setActiveBildeId(active);
    if (wasPinned && groundOverlayOwner() == null) pin(wasPinned);
  }, [stripOpen, activeBildeId, pinnedId, pin]);

  /*
   * Picking a thumbnail *is* "Vis i ruta" (§4.2), in both stances. Pressing
   * the active one again puts it down, which is the only way the rail has to
   * mean "nothing", and the images that cannot be placed are exactly the ones
   * with nothing to place.
   *
   * It was show-only, and the asymmetry was a fear about the wrong caller. The
   * ground overlay is one slot with two contenders (map/groundOverlay.ts) and
   * the other is a live terrain render, so the worry was that a rail laying
   * every card it walked past onto the map would knock the render down the
   * instant a `Behold` result landed and moved the cursor onto it. `Behold`
   * does not move the cursor; nothing that adds a record does. The only thing
   * that selects a card for you is the auto-select in `BilderCarousel`, and
   * that goes through `focusBilde`, which does not pin. What was left of the
   * rule was two identical rails (§8.7.2) answering a click differently.
   *
   * Two records it refuses. One with no file or no extent cannot be laid down
   * at all — `canPinBilde`. A borrowed one (§7) is the *original's* file and is
   * not in `attachmentItems`, so `usePinnedBilde` has nothing to resolve it
   * against; reading one is `Åpne originalen`, and `Ta med` is what makes it
   * this lokalitet's.
   *
   * Walking away from a card still puts its image down: a pin that outlived
   * the card it belongs to points at something the surface is no longer
   * showing.
   */
  const pinOnWalk = useCallback(
    (rec: AttachmentRecord | null | undefined) => {
      pin(rec && canPinBilde(rec) && !inheritedIds.has(rec.id) ? rec.id : null);
    },
    [inheritedIds, pin],
  );

  /**
   * Point the rail at a record without touching the map — for the surface
   * selecting *for* you, as against `selectBilde`, which is a press.
   *
   * `BilderCarousel` lands on the first image when edit opens, because a
   * surface entered in order to change something should not make you pick a
   * subject before you can. That is a good default for the cursor and a bad
   * one for the ground: the terrain render you were reading when you pressed
   * `Rediger` is not something the rail gets to replace on its own.
   */
  const focusBilde = useCallback((id: string | null) => {
    setActiveBildeId(id);
  }, []);

  const selectBilde = useCallback(
    (id: string | null) => {
      const next = id === activeBildeId ? null : id;
      setActiveBildeId(next);
      pinOnWalk(next ? bilderItems?.find((a) => a.id === next) : null);
    },
    [activeBildeId, bilderItems, pinOnWalk],
  );

  // ←/→. Wraps, and never lands on nothing: walking a rail past its end and
  // getting an empty strip would be a worse answer than starting over.
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
      const rec = items[next];
      setActiveBildeId(rec.id);
      pinOnWalk(rec);
    },
    [bilderItems, activeBildeId, pinOnWalk],
  );

  // Deferred, not done (§5.6). The record stays on the rail, greyed, and
  // `Avbryt` — or `restoreDeleted` on the card — gives it back.
  //
  // The pin goes down with it. The tombstone stays in `bilderItems`, so the
  // sweep above will not do it, and now that picking a frame lays it on the
  // ground the ordinary path — pick it, decide against it, press `Slett` —
  // ends with the selection cleared and the image still on the map, named by
  // nothing.
  const removeBilde = useCallback(
    (rec: AttachmentRecord) => {
      mutateDraft((d) => dropAttachment(d, rec.id));
      setActiveBildeId((cur) => (cur === rec.id ? null : cur));
      if (pinnedId === rec.id) pin(null);
    },
    [mutateDraft, pin, pinnedId],
  );

  // Into the buffer, which is also what makes the drag not snap back: there
  // is no round trip to wait out any more.
  const patchBilde = useCallback(
    (
      rec: AttachmentRecord,
      patch: { caption?: string; sort?: number; hidden?: boolean },
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

  // Keep it, do not show it (§4.4). The alternative to this field is deleting
  // your working renders to make the exhibit tidy, and the seven you rejected
  // are the evidence that you checked.
  const setBildeHidden = useCallback(
    (rec: AttachmentRecord, hidden: boolean) => patchBilde(rec, { hidden }),
    [patchBilde],
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
  // The autosave's controls, handed over once that hook has run further down.
  // Refs because the two halves point at each other: the hook is driven by
  // callbacks defined here (create the record, patch it), and those callbacks
  // in turn have to be able to flush a pending write or re-point the pen. The
  // unmount path above needs the flush for the same reason.
  const flushDraftRef = useRef<() => void>(() => {});
  const rebindDraftRef = useRef<() => void>(() => {});

  useEffect(() => {
    setLocalityHighlight(locality.id);
    return () => setLocalityHighlight(null);
  }, [locality.id]);

  // Draft/adjust/tool/selection cleanup when the workspace closes or
  // swaps lokalitet.
  useEffect(() => {
    return () => {
      // Before the clear below, not after: closing the workspace mid-stroke
      // should write the stroke, and the draw layer is where it still is.
      flushDraftRef.current();
      setDraftActive(false);
      setAdjusting(false);
      setTool(null);
      setSelectedFunnId(null);
      setFunnOutside(false);
      hideFunnOnLayer(null);
      getDrawLayer()?.getSource()?.clear();
      // And the curtain comes down with the row that raised it
      // (docs/lokalitet-view.md §8). Sammenlign's only control moved onto the
      // lokalitet row, so leaving the lokalitet with it up would strand a
      // second live tile stack on screen with no way to close it — which is
      // Kartverket's request budget doubled, silently and indefinitely.
      leaveCompare();
    };
  }, [
    locality.id,
    setDraftActive,
    setAdjusting,
    setTool,
    setSelectedFunnId,
    setFunnOutside,
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
  // only puts the pen down: flush whatever is still settling, take the drawing
  // off the shared draw layer, and let the funn layer show the funn again.
  const stopDraft = useCallback(() => {
    flushDraftRef.current();
    getDrawLayer()?.getSource()?.clear();
    hideFunnOnLayer(null);
    if (draftFunnId) {
      const rec = findItems?.find((it) => it.id === draftFunnId);
      // The flush a line ago may not have landed in state yet; the buffer's
      // own re-render puts the newer shape up a tick later.
      if (rec) upsertFunnOnLayer(rec);
    }
    setDraftFunnId(null);
    setDraftIsEdit(false);
    setDraftActive(false);
  }, [draftFunnId, findItems, setDraftActive]);

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
  const reportDrawnExtent = useCallback(
    (extent: LocalityBbox | null) =>
      setFunnOutside(extent != null && !bboxContains(locality.bbox, extent)),
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
  rebindDraftRef.current = autosave.rebind;

  // Recomputed from the live drawing rather than from whatever the flag was
  // raised with, so it can't grow the rectangle to fit a shape that has since
  // been moved back inside.
  const growToFitDrawing = useCallback(() => {
    const projection = map.getView().getProjection().getCode();
    const drawn = getDrawLayerExtent4326(projection);
    if (!drawn) return;
    patchLocality({ bbox: bboxUnion(locality.bbox, drawn) });
    setFunnOutside(false);
  }, [map, locality.bbox, patchLocality, setFunnOutside]);

  const startDraft = useCallback(() => {
    if (!canAdd || draftActive) return;
    // Leftovers on the shared draw layer can only be a drawing that was
    // already saved and put down; drop them so the new funn starts clean.
    getDrawLayer()?.getSource()?.clear();
    hideFunnOnLayer(null);
    // The eye on `Funn` is a way of looking at the ground, not a way of
    // working on it: drawing with the existing funn invisible is how you end
    // up drawing the one you already have.
    setFunnHidden(false);
    setAdjusting(false);
    // Only the extract is dismissed — terrain is a read-only view of the
    // same rectangle and there is no reason drawing on top should close it.
    setTool((cur) => (cur === 'lidar' ? null : cur));
    setDraftFunnId(null);
    setDraftIsEdit(false);
    setFunnTitle('');
    setGeometryBefore(null);
    setDraftActive(true);
  }, [
    canAdd,
    draftActive,
    setFunnHidden,
    setAdjusting,
    setTool,
    setDraftActive,
  ]);

  const startGeometryEdit = useCallback(
    (f: LocalityFindRecord) => {
      // Reachable from the list while another funn is being drawn, so put
      // that one down first — including anything of it still settling.
      if (draftActive) stopDraft();
      getDrawLayer()?.getSource()?.clear();
      setAdjusting(false);
      setTool((cur) => (cur === 'lidar' ? null : cur));
      setDrawLayerFeatures(f.geometry, 'EPSG:4326', true);
      // Its own shapes, not an edit of them.
      rebindDraftRef.current();
      hideFunnOnLayer(f.id);
      setDraftFunnId(f.id);
      setDraftIsEdit(true);
      setFunnTitle(f.title);
      // What `Forkast funn` will put back, taken from the overlaid record so
      // that a second edit in the same session restores the first one's
      // result rather than the server's copy.
      setGeometryBefore(findBaseOf(f));
      setDraftActive(true);
    },
    [
      draftActive,
      stopDraft,
      setAdjusting,
      setTool,
      setDrawLayerFeatures,
      setDraftActive,
    ],
  );

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
    if (draftActive) stopDraft();
    setAdjusting(false);
    setTool('lidar');
  }, [draftActive, stopDraft, setAdjusting, setTool]);

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
    if (draftActive) stopDraft();
    setBboxBefore(localityRef.current.bbox);
    setAdjusting(true);
  }, [adjusting, draftActive, stopDraft, setAdjusting]);

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
    if (draftActive) stopDraft();
    setAdjusting(false);
    setBboxBefore(null);
    closeLidar();
    setEditingId((cur) => (cur === locality.id ? null : cur));
  }, [
    draftActive,
    stopDraft,
    setAdjusting,
    closeLidar,
    locality.id,
    setEditingId,
  ]);

  /**
   * `Lagre` (§5.6).
   *
   * The stance drops as soon as the records land, and the *pixels* go out
   * behind it — which is the third consequence taken at its word: the last
   * step of a commit may be a tile burst that has not started yet, so
   * holding the interface shut until every pixel exists would be holding it
   * shut for a minute. What the author asked for was to be done editing, and
   * they are.
   *
   * The specs that landed go to the pin queue on the way past. Everything
   * else — the per-card state, the retry, `Last ned` waiting for its pin —
   * is machinery §4.1.2 already built for exactly this moment.
   */
  const saveEdit = useCallback(async () => {
    if (saving) return;
    if (draftActive) flushDraftRef.current();
    setSaving(true);
    // Read before `standDown`, because the flush above may still be in the
    // same tick as the state it wrote.
    const wasChangedElsewhere = changedElsewhere;
    try {
      const result = await commitDraft();
      if (result.ok) {
        standDown();
        // The buffered shapes on the map were pushed on under temporary ids;
        // the records that just landed have real ones.
        refreshFunnLayer();
      }
      for (const rec of result.created) {
        enqueuePin({
          rec,
          bbox4326: localityRef.current.bbox,
          subject: localityRef.current.name || undefined,
        });
      }
      if (!result.ok) {
        // Stay in edit. The buffer now holds exactly what did not land, the
        // exits are still on the row, and pressing `Lagre` again retries
        // precisely that remainder — which is the only reading of "still in
        // the draft" that the toast can honestly make.
        toast.error({
          title: t('localities.edit.saveFailed', { count: result.failed }),
        });
      } else if (wasChangedElsewhere) {
        // Last write wins, which is acceptable for one author with two tabs.
        // Doing it silently would not be (§5.6, consequence 5).
        toast.create({ title: t('localities.edit.changedElsewhere') });
      }
    } finally {
      setSaving(false);
    }
  }, [saving, draftActive, changedElsewhere, commitDraft, standDown, t]);

  /**
   * `Avbryt`.
   *
   * The buffer is dropped and the eagerly written Files are deleted after
   * it. The confirm that names what is being thrown away lives on the row,
   * where the count is; by the time this runs the decision is made.
   */
  const cancelEdit = useCallback(async () => {
    const eager = draft?.eagerIds ?? [];
    standDown();
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
  }, [draft, standDown, setAttachmentItems, rollbackDraft, t]);

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
            metresPerPx: shot.metresPerPx,
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
   */
  const takeBilde = useCallback(
    async (rec: AttachmentRecord) => {
      if (!user || !canAdd || takingId) return;
      setTakingId(rec.id);
      try {
        const url = await getAttachmentUrl(rec);
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
        meta: {
          sourceLabel: 'Norge i bilder',
          // The rectangle, but not the resolution: which acquisition over
          // which ground is the spec, and what NiB actually serves for it
          // is a fact about pixels that do not exist yet.
          bbox25833: beholdBbox,
          // Which NiB source this is, said in a way a machine can act on:
          // the seamless mosaic and one acquisition are different
          // requests, and "no projectName key" is a poor way to tell them
          // apart once a reader has to re-lay this image on the map.
          ...(project
            ? {
                nibSource: 'project',
                // The ImageServer's own selector (prosjektnavn), which is
                // the same string as projectName today — kept as its own
                // key because the display name is free to stop being the
                // selector and matching an acquisition by its year label
                // breaks the day two projects share a year.
                projectId: project.id,
                projectName: project.projectName,
                // The acquisition's native resolution. `fetchFlyfoto`
                // needs it to plan the tile grid, and unlike the stitch's
                // own it is knowable before the stitch happens.
                projectMetresPerPx: project.metresPerPx,
                year: project.year,
                photoDate: project.photoDate,
              }
            : { nibSource: 'mosaic' }),
        },
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
   * Both routes to one go through here — the starter set below and `Behold`
   * over the LiDAR ground — and both used to hand this a finished
   * `ExtractRaster`, i.e. a stitch that had already happened. A dataset, a
   * style, a model and the rectangle is the entire question that stitch
   * answers, so there is nothing left for the caller to fetch first: this
   * takes the `LidarSource` straight from the catalogue and writes the row.
   *
   * The starter set's images land as `extract` attachments, same as one made
   * by hand from the extract tool: a laser-derived picture of the rectangle is
   * what that kind means, and the meta is the same set of keys, so nothing
   * downstream has to know which route produced an image.
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
        meta: {
          sourceKey: source.key,
          sourceLabel: source.label,
          style,
          model: source.model,
          bbox25833: beholdBbox,
        },
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
   * small POSTs — so the whole run is over in about a second, and the rail
   * fills with three cards that say they are being fetched. The images
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
   * Since step 13 the three writes are three lines in the draft buffer, so
   * the only fallible thing left in here is the catalogue lookup: the set
   * either lands whole or was never planned.
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

      for (const style of plan.styles) saveExtractSpec(plan.source, style);

      toast.success({
        // One count, not "n of m": buffering three specs is not a thing that
        // can partly fail, so the only fallible step left is the catalogue
        // lookup above — and it answers before any of them are written.
        title: t('localities.tools.starterDone', {
          count: plan.styles.length,
        }),
      });
    } finally {
      setStarterBusy(false);
    }
  }, [user, canAdd, starterBusy, locality.bbox, saveExtractSpec, t]);

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
    // to say which of `Lagre` and `Avbryt` they meant.
    onEscape: () => {
      if (mode === 'lidar') closeLidar();
      else if (adjusting) undoAdjust();
      else if (selectedFunnId) setSelectedFunnId(null);
      else if (stance === 'edit') {
        if (!dirty) void cancelEdit();
      } else setActiveLocality(null);
    },
  });

  const funnCount = findItems?.length ?? 0;
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
    }),
    [locality.bbox, locality.name],
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
    saving,
    dirty,
    draftCounts: counts,
    /** When a buffer came back off disk, for the recovery banner (§5.7). */
    restoredAt,
    /** `Forkast` on that banner: drop it and leave edit, nothing to confirm. */
    discardRecovered: cancelEdit,
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
    pinned,
    funnCount,
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
    reorderBilde,

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

    // grow-to-fit
    funnOutside,
    growToFitDrawing,

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
