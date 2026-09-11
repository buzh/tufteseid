import type { FeatureCollection } from 'geojson';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AttachmentRecord,
  createAttachment,
  createAttachmentSpec,
  deleteAttachment,
  updateAttachment,
} from '../api/attachments';
import {
  deleteLocality,
  LocalityBbox,
  LocalityPatch,
  LocalityRecord,
  updateLocality,
} from '../api/localities';
import {
  createLocalityFind,
  deleteLocalityFind,
  LocalityFindRecord,
  LocalityFindStatus,
  updateLocalityFind,
} from '../api/localityFinds';
import { currentUserAtom, isAdminAtom } from '../auth/atoms';
import { useDrawSettings } from '../draw/drawControls/hooks/drawSettings';
import { getDrawLayer } from '../draw/drawControls/hooks/mapLayers';
import { renderFigureBlob } from '../figure/figure';
import { describeHeritageRender, screenshotFigure } from '../figure/specs';
import type { LidarSource } from '../lidarExtract/sources';
import { mapAtom } from '../map/atoms';
import { activeThemeLayersAtom } from '../map/layers/atoms';
import {
  heritageDetailsAtom,
  heritageOpacityAtom,
  heritageRenderAtom,
} from '../map/layers/heritage';
import { compareOnAtom } from '../map/compare/halves';
import type { BackgroundLayerName } from '../map/layers/backgroundLayers';
import {
  backgroundLayerHalves,
  hybridOverlayHalves,
} from '../map/layers/config/backgroundLayers/atoms';
import { fitPadding } from '../shell/chromeInsets';
import { terrainStandaloneBboxAtom } from '../terrain/atoms';
import { toast } from '../ui';
import {
  activeLocalityAtom,
  adjustingLocalityAtom,
  coverTerrainSpecAtom,
  editingLocalityIdAtom,
  funnDraftActiveAtom,
  marksHiddenAtom,
  pendingStarterLocalityIdAtom,
  selectedFunnIdAtom,
} from './atoms';
import {
  attachmentMatchesKey,
  type BeholdKey,
  beholdOfferAtom,
  NIB_MOSAIC_KEY,
} from './behold';
import {
  fetchFlyfotoProjectsForBbox,
  type FlyfotoProject,
} from './flyfotoProjects';
import {
  getFunnExtentOnLayer,
  hideFunnOnLayer,
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
import { useKulturminner } from './useKulturminner';
import { useLocalityAdjust } from './useLocalityAdjust';
import {
  useLocalityAttachments,
  useLocalityFinds,
} from './useLocalityContent';
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
  const setMarksHidden = useSetAtom(marksHiddenAtom);
  const [tool, setTool] = useAtom(ribbonToolAtom);
  const mode = useAtomValue(workspaceModeAtom);
  const stripOpen = useAtomValue(bilderStripOpenAtom);
  const [funnOutside, setFunnOutside] = useAtom(funnOutsideAtom);
  const setTerrainStandaloneBbox = useSetAtom(terrainStandaloneBboxAtom);
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
  const [fetchingFlyfoto, setFetchingFlyfoto] = useState(false);
  // Whether the licensing notice is up, and what accepting it does. Two
  // routes reach NiB now — the acquisition picker and `Behold` over the
  // flyfoto ground — and consent is owed on both, so the notice grew a
  // destination rather than a second copy.
  const [flyfotoNotice, setFlyfotoNotice] = useState<
    'picker' | 'behold' | null
  >(null);
  const [beholding, setBeholding] = useState(false);
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

  // Mounts the move/resize interactions while adjustingLocalityAtom is
  // set; persists the bbox after every finished gesture.
  useLocalityAdjust(locality);

  const { items: findItems, setItems: setFindItems } = useLocalityFinds(
    locality.id,
  );
  const { items: attachmentItems, setItems: setAttachmentItems } =
    useLocalityAttachments(locality.id);
  const kulturminner = useKulturminner(locality.bbox);
  // "Vis i ruta". Mounted here rather than in the strip because the strip is
  // collapsible and unmounts when it is folded away — and folding it away to
  // look at the map is exactly what you do after putting an image on it.
  const pinned = usePinnedBilde(attachmentItems);
  const { pin } = pinned;

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
  const bilderItems = useMemo(() => {
    if (!attachmentItems) return null;
    return canEdit ? attachmentItems : attachmentItems.filter((a) => !a.hidden);
  }, [attachmentItems, canEdit]);

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
   * Picking a thumbnail *is* "Vis i ruta" — in show (§4.2). Pressing the
   * active one again puts it down, which is the only way the filmstrip has to
   * mean "nothing", and the images that cannot be placed are exactly the ones
   * with nothing to place.
   *
   * In edit it is not, and that asymmetry is deliberate. The ground overlay is
   * one slot with two contenders (map/groundOverlay.ts), and the other is a
   * live terrain render — so a carousel that laid every card it walked past
   * onto the map would knock the render down the instant a `Behold` result
   * landed and moved the cursor onto it. In edit, laying an image on the
   * ground is a verb on the card, pressed on purpose.
   *
   * Walking away from a card still puts its image down either way: a pin that
   * outlived the card it belongs to points at something the surface is no
   * longer showing.
   */
  const pinOnWalk = useCallback(
    (rec: AttachmentRecord | null | undefined) => {
      pin(!canEdit && rec && canPinBilde(rec) ? rec.id : null);
    },
    [canEdit, pin],
  );

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

  const removeBilde = useCallback(
    async (rec: AttachmentRecord) => {
      try {
        await deleteAttachment(rec.id);
        setAttachmentItems((prev) =>
          prev ? prev.filter((it) => it.id !== rec.id) : prev,
        );
        setActiveBildeId((cur) => (cur === rec.id ? null : cur));
      } catch (e) {
        console.warn('[localityWorkspace] bilde delete failed', e);
        toast.error({ title: t('localities.workspace.saveFailed') });
      }
    },
    [setAttachmentItems, t],
  );

  // One patch, applied optimistically and rolled back on failure. The list is
  // reloaded wholesale by realtime anyway; the optimistic step is what keeps
  // a drag from snapping back for the length of a round trip.
  const patchBilde = useCallback(
    async (
      rec: AttachmentRecord,
      patch: { caption?: string; sort?: number; hidden?: boolean },
    ) => {
      setAttachmentItems((prev) =>
        prev
          ? prev.map((it) => (it.id === rec.id ? { ...it, ...patch } : it))
          : prev,
      );
      try {
        const updated = await updateAttachment(rec.id, patch);
        setAttachmentItems((prev) =>
          prev ? prev.map((it) => (it.id === rec.id ? updated : it)) : prev,
        );
      } catch (e) {
        console.warn('[localityWorkspace] bilde save failed', e);
        toast.error({ title: t('localities.workspace.saveFailed') });
        setAttachmentItems((prev) =>
          prev ? prev.map((it) => (it.id === rec.id ? rec : it)) : prev,
        );
      }
    },
    [setAttachmentItems, t],
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
   */
  const reorderBilde = useCallback(
    async (id: string, toIndex: number) => {
      const list = attachmentItems;
      if (!list) return;
      const from = list.findIndex((a) => a.id === id);
      if (from < 0) return;
      const to = Math.max(0, Math.min(list.length - 1, toIndex));
      if (to === from) return;

      const rest = list.filter((a) => a.id !== id);
      const next = [...rest.slice(0, to), list[from], ...rest.slice(to)];
      setAttachmentItems(next);

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

      try {
        const value = between();
        if (value != null) {
          await updateAttachment(id, { sort: value });
        } else {
          // No room. Space the whole exhibit out again, in the order it now
          // reads, and leave it that way — the values stay far below any
          // clock reading, so the next image created still lands last.
          for (let i = 0; i < next.length; i++) {
            await updateAttachment(next[i].id, { sort: (i + 1) * SORT_STEP });
          }
        }
      } catch (e) {
        console.warn('[localityWorkspace] reorder failed', e);
        toast.error({ title: t('localities.workspace.saveFailed') });
        setAttachmentItems(list);
      }
    },
    [attachmentItems, setAttachmentItems, t],
  );

  // Funn draft. `draftFunnId` is the record the pen is bound to — null only
  // until the first shape closes, since drawing autosaves. `draftIsEdit`
  // distinguishes the two ways in: a new funn, or "Rediger tegningen" on one
  // that already exists.
  const [draftFunnId, setDraftFunnId] = useState<string | null>(null);
  const [draftIsEdit, setDraftIsEdit] = useState(false);
  const [funnTitle, setFunnTitle] = useState('');
  const [savingFunn, setSavingFunn] = useState(false);
  const [funnError, setFunnError] = useState<string | null>(null);
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
    // A standalone terrain analysis may be up over the bare map. Opening a
    // lokalitet rescopes the ribbon, and leaving a rectangle unrelated to it
    // in row 3 would mean "Lagre" quietly created a *second* lokalitet.
    setTerrainStandaloneBbox(null);
    return () => {
      // Before the clear below, not after: closing the workspace mid-stroke
      // should write the stroke, and the draw layer is where it still is.
      flushDraftRef.current();
      setDraftActive(false);
      setAdjusting(false);
      setTool(null);
      setLidarSelection(null);
      setSelectedFunnId(null);
      setFunnOutside(false);
      hideFunnOnLayer(null);
      getDrawLayer()?.getSource()?.clear();
    };
  }, [
    locality.id,
    setDraftActive,
    setAdjusting,
    setTool,
    setLidarSelection,
    setSelectedFunnId,
    setFunnOutside,
    setTerrainStandaloneBbox,
  ]);

  // The funn draft used to be reset by the whole panel remounting on a
  // lokalitet swap. It no longer does, so clear it here.
  useEffect(() => {
    setDraftFunnId(null);
    setDraftIsEdit(false);
    setFunnTitle('');
    setFunnError(null);
  }, [locality.id]);

  const patchLocality = useCallback(
    async (patch: LocalityPatch) => {
      try {
        const updated = await updateLocality(locality.id, patch);
        upsertLocalityOnLayer(updated);
        setActiveLocality(updated);
        return updated;
      } catch (e) {
        console.warn('[localityWorkspace] save failed', e);
        toast.error({ title: t('localities.workspace.saveFailed') });
        return null;
      }
    },
    [locality.id, setActiveLocality, t],
  );

  const close = useCallback(
    () => setActiveLocality(null),
    [setActiveLocality],
  );

  // `Rediger`. Costs nothing on purpose (§2): no fetch, no write, the map
  // does not move and the render does not blink — which is what lets show
  // mode be absolute about writing nothing without being in the way.
  const enterEdit = useCallback(() => {
    if (mayEdit) setEditingId(locality.id);
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

  const rename = useCallback(
    async (next: string) => {
      const trimmed = next.trim();
      if (trimmed.length === 0 || trimmed === locality.name) return false;
      await patchLocality({ name: trimmed });
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

  const removeLocality = useCallback(async () => {
    try {
      await deleteLocality(locality.id);
      removeLocalityFromLayer(locality.id);
      setActiveLocality(null);
    } catch (e) {
      console.warn('[localityWorkspace] delete failed', e);
      toast.error({ title: t('localities.workspace.saveFailed') });
    }
  }, [locality.id, setActiveLocality, t]);

  // Stopping is not discarding. The record exists from the moment the first
  // shape closed and every change since has been written back, so this only
  // puts the pen down: flush whatever is still settling, take the drawing off
  // the shared draw layer, and let the funn layer show the saved copy again.
  const stopDraft = useCallback(() => {
    flushDraftRef.current();
    getDrawLayer()?.getSource()?.clear();
    hideFunnOnLayer(null);
    if (draftFunnId) {
      const rec = findItems?.find((it) => it.id === draftFunnId);
      // The flush a line ago may not have landed yet; the realtime event it
      // causes re-hydrates this with the newer shape a moment later.
      if (rec) upsertFunnOnLayer(rec);
    }
    setDraftFunnId(null);
    setDraftIsEdit(false);
    setDraftActive(false);
  }, [draftFunnId, findItems, setDraftActive]);

  // The way back out of an autosave, offered in the toast that reports it —
  // which is what lets the first shape commit without asking first.
  const undoFunn = useCallback(
    async (id: string) => {
      hideFunnOnLayer(null);
      getDrawLayer()?.getSource()?.clear();
      rebindDraftRef.current();
      // The pen stays armed: the next shape starts a new funn.
      setDraftFunnId((cur) => (cur === id ? null : cur));
      try {
        await deleteLocalityFind(id);
        removeFunnFromLayer(id);
        setFindItems((prev) =>
          prev ? prev.filter((it) => it.id !== id) : prev,
        );
        setSelectedFunnId((cur) => (cur === id ? null : cur));
      } catch (e) {
        console.warn('[localityWorkspace] funn undo failed', e);
        toast.error({ title: t('localities.funn.saveFailed') });
      }
    },
    [setFindItems, setSelectedFunnId, t],
  );

  // First finished shape → the record. Title falls back to a running number
  // rather than blocking on one being typed: a funn you can rename is worth
  // more than a funn you have to name.
  const createDraftFunn = useCallback(
    async (geometry: FeatureCollection): Promise<boolean> => {
      if (!user) return false;
      setSavingFunn(true);
      try {
        const saved = await createLocalityFind(
          {
            locality: locality.id,
            title:
              funnTitle.trim() ||
              t('localities.funn.autoName', {
                n: (findItems?.length ?? 0) + 1,
              }),
            geometry,
          },
          user.id,
        );
        setFindItems((prev) => (prev ? [...prev, saved] : [saved]));
        // The shapes are on the draw layer already; keep the funn layer's
        // copy out from under them until drawing stops.
        hideFunnOnLayer(saved.id);
        setDraftFunnId(saved.id);
        setFunnTitle(saved.title);
        setSelectedFunnId(saved.id);
        setFunnError(null);
        toast.success({
          title: t('localities.funn.autoSaved', { title: saved.title }),
          action: {
            label: t('localities.funn.undo'),
            onClick: () => undoFunn(saved.id),
          },
        });
        return true;
      } catch (e) {
        console.warn('[localityWorkspace] funn autosave (create) failed', e);
        setFunnError(t('localities.funn.saveFailed'));
        return false;
      } finally {
        setSavingFunn(false);
      }
    },
    [
      user,
      locality.id,
      findItems,
      funnTitle,
      setFindItems,
      setSelectedFunnId,
      undoFunn,
      t,
    ],
  );

  const updateDraftGeometry = useCallback(
    async (id: string, geometry: FeatureCollection): Promise<boolean> => {
      setSavingFunn(true);
      try {
        const saved = await updateLocalityFind(id, { geometry });
        setFindItems((prev) =>
          prev ? prev.map((it) => (it.id === id ? saved : it)) : prev,
        );
        setFunnError(null);
        return true;
      } catch (e) {
        console.warn('[localityWorkspace] funn autosave (geometry) failed', e);
        setFunnError(t('localities.funn.saveFailed'));
        return false;
      } finally {
        setSavingFunn(false);
      }
    },
    [setFindItems, t],
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
  const growToFitDrawing = useCallback(async () => {
    const projection = map.getView().getProjection().getCode();
    const drawn = getDrawLayerExtent4326(projection);
    if (!drawn) return;
    if (await patchLocality({ bbox: bboxUnion(locality.bbox, drawn) })) {
      setFunnOutside(false);
    }
  }, [map, locality.bbox, patchLocality, setFunnOutside]);

  const startDraft = useCallback(() => {
    if (!canAdd || draftActive) return;
    // Leftovers on the shared draw layer can only be a drawing that was
    // already saved and put down; drop them so the new funn starts clean.
    getDrawLayer()?.getSource()?.clear();
    hideFunnOnLayer(null);
    // "Skjul markeringer" is a way of looking at the ground, not a way of
    // working on it: drawing with the existing funn invisible is how you end
    // up drawing the one you already have.
    setMarksHidden(false);
    setAdjusting(false);
    // Only the extract is dismissed — terrain is a read-only view of the
    // same rectangle and there is no reason drawing on top should close it.
    setTool((cur) => (cur === 'lidar' ? null : cur));
    setLidarSelection(null);
    setDraftFunnId(null);
    setDraftIsEdit(false);
    setFunnTitle('');
    setFunnError(null);
    setDraftActive(true);
  }, [
    canAdd,
    draftActive,
    setMarksHidden,
    setAdjusting,
    setTool,
    setLidarSelection,
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
      setFunnError(null);
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

  const toggleAdjusting = useCallback(() => {
    if (!adjusting && draftActive) stopDraft();
    setAdjusting(!adjusting);
  }, [adjusting, draftActive, stopDraft, setAdjusting]);

  /**
   * `Ferdig` — leave edit and go back to show.
   *
   * Not `Lagre`: the app still autosaves, so there is nothing here to commit.
   * The transaction that turns this into `Lagre` / `Avbryt` is step 13 of
   * docs/lokalitet-view.md §12, and until then `Ferdig` over autosave is the
   * honest word for what the button does.
   *
   * It puts the edit-only tools down on the way out, because every one of
   * them is a write surface: leaving the pen armed or the extract selection
   * live in a stance whose whole promise is that nothing writes would be the
   * invariant leaking through the one door that closes it.
   */
  const leaveEdit = useCallback(() => {
    if (draftActive) stopDraft();
    setAdjusting(false);
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
      } catch (e) {
        console.warn('[localityWorkspace] upload failed', e);
        toast.error({ title: t('localities.bilder.uploadFailed') });
      } finally {
        setUploading(false);
      }
    },
    [user, canAdd, uploading, locality.id, setAttachmentItems, t],
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
   */
  const grabFlyfoto = useCallback(
    async (project?: FlyfotoProject): Promise<boolean> => {
      if (!user || !canAdd) return false;
      const label = project
        ? (project.year?.toString() ?? project.projectName)
        : t('localities.tools.flyfotoMosaic');
      try {
        const rec = await createAttachmentSpec(
          {
            locality: locality.id,
            kind: 'flyfoto',
            // A project's own year is what makes the gallery readable as a
            // time series; the mosaic has no year, so it gets the date it
            // was grabbed instead.
            caption: `${t('localities.tools.flyfotoCaption')} ${
              project ? label : new Date().toLocaleDateString(i18n.language)
            }`,
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
          },
          user.id,
        );
        setAttachmentItems((prev) => (prev ? [...prev, rec] : [rec]));
        enqueuePin({
          rec,
          bbox4326: locality.bbox,
          subject: locality.name || undefined,
        });
        return true;
      } catch (e) {
        console.warn('[localityWorkspace] flyfoto failed', e);
        toast.error({
          title: t('localities.tools.flyfotoFailedFor', { label }),
        });
        return false;
      }
    },
    [
      user,
      canAdd,
      locality.id,
      locality.name,
      locality.bbox,
      beholdBbox,
      setAttachmentItems,
      t,
      i18n.language,
    ],
  );

  /*
   * The one remaining straight-to-record grab: `Behold` over the flyfoto
   * ground.
   *
   * The acquisition list no longer comes through here — since §4.3 picking
   * acquisitions opens a picker run instead, and nothing is written until a
   * card is kept. `Behold` is the other gesture: it keeps *what is already on
   * screen*, so there is nothing to propose and nothing to triage.
   */
  const runFlyfoto = useCallback(
    async (project?: FlyfotoProject) => {
      if (fetchingFlyfoto) return;
      setFetchingFlyfoto(true);
      try {
        if (await grabFlyfoto(project)) {
          toast.success({ title: t('localities.tools.flyfotoSaved') });
        }
      } finally {
        setFetchingFlyfoto(false);
      }
    },
    [fetchingFlyfoto, grabFlyfoto, t],
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
    async (source: LidarSource, style: string) => {
      if (!user) return;
      const rec = await createAttachmentSpec(
        {
          locality: locality.id,
          kind: 'extract',
          caption: `${source.label} · ${style}`,
          meta: {
            sourceKey: source.key,
            sourceLabel: source.label,
            style,
            model: source.model,
            bbox25833: beholdBbox,
          },
        },
        user.id,
      );
      setAttachmentItems((prev) => (prev ? [...prev, rec] : [rec]));
      enqueuePin({
        rec,
        bbox4326: locality.bbox,
        subject: locality.name || undefined,
      });
    },
    [
      user,
      locality.id,
      locality.name,
      locality.bbox,
      beholdBbox,
      setAttachmentItems,
    ],
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
        return true;
      } catch (e) {
        console.warn('[localityWorkspace] picker keep failed', e);
        toast.error({ title: t('localities.picker.keepFailed') });
        return false;
      }
    },
    [user, canAdd, locality.id, setAttachmentItems, t],
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
  // it: `Ferdig` on the row drops the picker along with the pen and the
  // extract dialog. An effect rather than a line in `leaveEdit` because
  // `canAdd` can also go false without that verb being pressed.
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
   * Each write is independently fallible — so failures are counted, not
   * thrown, and the toast says how many of the planned set arrived.
   */
  const runStarterPack = useCallback(async () => {
    if (!user || !canAdd || starterBusy) return;
    setStarterBusy(true);
    let saved = 0;
    try {
      // The catalogue lookup is the first thing that can answer "is there any
      // laser data here at all", and it costs one cached request.
      const plan = await planStarterPack(locality.bbox);
      if (!plan) {
        toast.error({ title: t('localities.tools.starterNone') });
        return;
      }

      for (const style of plan.styles) {
        try {
          await saveExtractSpec(plan.source, style);
          saved++;
        } catch (e) {
          console.warn('[localityWorkspace] starter spec failed', e);
        }
      }

      if (saved === 0) {
        toast.error({ title: t('localities.tools.starterNone') });
      } else {
        toast.success({
          title: t('localities.tools.starterDone', {
            saved,
            total: plan.styles.length,
          }),
        });
      }
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

  const behold = useCallback(async () => {
    if (!user || !canAdd || beholding || !offer) return;

    // Ortofoto is the one arm that cannot start with a fetch: NiB's terms
    // have to be shown and accepted first, so the button's job here is to
    // raise the notice and hand the work to `acceptFlyfotoNotice`.
    if (offer.ground === 'flyfoto') {
      setFlyfotoNotice('behold');
      return;
    }

    setBeholding(true);
    try {
      if (offer.ground === 'lidar') {
        if (!offer.source) return;
        await saveExtractSpec(offer.source, offer.style);
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
        const rec = await createAttachmentSpec(
          {
            locality: locality.id,
            kind: spec.kind,
            caption: spec.caption,
            meta: spec.meta,
          },
          user.id,
        );
        setAttachmentItems((prev) => (prev ? [...prev, rec] : [rec]));
        enqueuePin({
          rec,
          bbox4326: locality.bbox,
          subject: locality.name || undefined,
        });
        toast.success({ title: t('localities.tools.beholdSaved') });
      }
    } catch (e) {
      console.warn('[localityWorkspace] behold failed', e);
      toast.error({ title: t('localities.tools.beholdFailed') });
    } finally {
      setBeholding(false);
    }
  }, [
    user,
    canAdd,
    beholding,
    offer,
    locality.id,
    locality.name,
    locality.bbox,
    saveExtractSpec,
    setAttachmentItems,
    t,
  ]);

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
  const closeFlyfotoPicker = useCallback(() => {
    if (!fetchingFlyfoto) setFlyfotoPicker(false);
  }, [fetchingFlyfoto]);

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
    async (f: LocalityFindRecord, status: LocalityFindStatus) => {
      try {
        const updated = await updateLocalityFind(f.id, { status });
        setFindItems((prev) =>
          prev ? prev.map((it) => (it.id === f.id ? updated : it)) : prev,
        );
      } catch (e) {
        console.warn('[localityWorkspace] status update failed', e);
        toast.error({ title: t('localities.funn.saveFailed') });
      }
    },
    [setFindItems, t],
  );

  const saveFunnMeta = useCallback(
    async (f: LocalityFindRecord, title: string, note: string) => {
      try {
        const updated = await updateLocalityFind(f.id, { title, note });
        setFindItems((prev) =>
          prev ? prev.map((it) => (it.id === f.id ? updated : it)) : prev,
        );
      } catch (e) {
        console.warn('[localityWorkspace] funn update failed', e);
        toast.error({ title: t('localities.funn.saveFailed') });
      }
    },
    [setFindItems, t],
  );

  // The draft band's own title and note edit the live record, same as a row
  // in the list: on blur, and never to an empty title — the auto-name exists
  // precisely so a funn always has one.
  const commitDraftMeta = useCallback(() => {
    const rec = findItems?.find((it) => it.id === draftFunnId);
    if (!rec) return;
    const title = funnTitle.trim();
    if (title.length === 0) {
      setFunnTitle(rec.title);
      return;
    }
    if (title === rec.title) return;
    saveFunnMeta(rec, title, rec.note ?? '');
  }, [findItems, draftFunnId, funnTitle, saveFunnMeta]);

  const removeFunn = useCallback(
    async (f: LocalityFindRecord) => {
      // Deleting the funn the pen is bound to would leave drawing armed
      // against a record that no longer exists.
      if (f.id === draftFunnId) stopDraft();
      try {
        await deleteLocalityFind(f.id);
        removeFunnFromLayer(f.id);
        setFindItems((prev) =>
          prev ? prev.filter((it) => it.id !== f.id) : prev,
        );
        if (selectedFunnId === f.id) setSelectedFunnId(null);
      } catch (e) {
        console.warn('[localityWorkspace] funn delete failed', e);
        toast.error({ title: t('localities.funn.saveFailed') });
      }
    },
    [
      draftFunnId,
      stopDraft,
      setFindItems,
      selectedFunnId,
      setSelectedFunnId,
      t,
    ],
  );

  /**
   * Depth 2's other exit (§5.3): put the pen down *and* take back what it
   * made.
   *
   * Offered only for a fresh draft, and the row only shows it there. Autosave
   * is what makes that asymmetry real: for a new funn, "forkast" can mean
   * delete the record the first closed shape created, and does. For a
   * geometry edit the old shape was overwritten the moment the new one
   * closed, so there is nothing left to restore and a button promising
   * otherwise would be lying. Step 13's edit transaction is what turns this
   * into a buffer discard for both cases; until then, the honest version of
   * the second case is not to offer it.
   */
  const discardDraft = useCallback(() => {
    const rec =
      !draftIsEdit && draftFunnId
        ? (findItems?.find((it) => it.id === draftFunnId) ?? null)
        : null;
    stopDraft();
    if (rec) void removeFunn(rec);
  }, [draftIsEdit, draftFunnId, findItems, stopDraft, removeFunn]);

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
    onEscape: () => {
      if (mode === 'lidar') closeLidar();
      else if (adjusting) setAdjusting(false);
      else if (selectedFunnId) setSelectedFunnId(null);
      else if (stance === 'edit') leaveEdit();
      else setActiveLocality(null);
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
  const kmCount = kulturminner.result
    ? kulturminner.result.truncated
      ? `${kulturminner.result.items.length}+`
      : kulturminner.result.items.length
    : null;

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
   */
  const coverBildeId = useMemo(
    () => attachmentItems?.find((a) => !a.hidden)?.id ?? null,
    [attachmentItems],
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
      if (rec.hidden) continue;
      const spec = viewSpecOf(rec);
      if (spec?.kind === 'terrain') return spec;
    }
    return null;
  }, [attachmentItems]);

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
   */
  useEffect(() => {
    if (!canAdd || !attachmentItems) return;
    for (const rec of attachmentItems) {
      if (isPinned(rec) || pinAttempted(rec.id)) continue;
      if (!viewSpecOf(rec)) continue;
      enqueuePin(pinJob(rec));
    }
  }, [canAdd, attachmentItems, pinJob]);

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
    leaveEdit,
    rename,
    zoomToLocality,
    removeLocality,
    patchLocality,

    // content
    findItems,
    // The exhibit, stance-filtered. The unfiltered list stays inside the hook:
    // it is what the ordering calls index into, and publishing both would be
    // publishing two answers to "which images does this lokalitet have".
    bilderItems,
    coverBildeId,
    pinned,
    kulturminner,
    funnCount,
    bilderCount,
    hasBilder,
    kmCount,

    // the bottom edge
    activeBildeId,
    selectBilde,
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
    savingFunn,
    funnError,
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
    toggleLidar,
    closeLidar,
    shooting,
    takeScreenshot,
    uploading,
    uploadFile,

    // flyfoto
    fetchingFlyfoto,
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
    beholding,
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
