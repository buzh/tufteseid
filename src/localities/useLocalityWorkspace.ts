import type { FeatureCollection } from 'geojson';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AttachmentRecord,
  createAttachment,
  deleteAttachment,
  updateAttachmentCaption,
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
import {
  describeHeritageRender,
  flyfotoFigure,
  screenshotFigure,
} from '../figure/specs';
import { lidarExtractSelectionAtom } from '../lidarExtract/atoms';
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
  selectedFunnIdAtom,
} from './atoms';
import { fetchFlyfoto } from './flyfoto';
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
import { captureLocalityScreenshot } from './screenshot';
import { getDrawLayerExtent4326 } from './serializeDrawLayer';
import {
  planStarterPack,
  starterExtract,
  STARTER_STYLES,
  type StarterRaster,
} from './starterPack';
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
import { canPinBilde, usePinnedBilde } from './usePinnedBilde';
import { useWorkspaceKeys } from './useWorkspaceKeys';
import { viewSpecOf } from './viewSpec';

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

// Sentinel for the seamless best-available mosaic in flyfotoBusy, which
// otherwise holds a project id.
export const FLYFOTO_MOSAIC = '__mosaic__';

// How many acquisitions "Hent alle" will take in one go. A busy area has
// well over a hundred — Oslo lists 121 — so the batch is the newest slice,
// not the whole list: each project is a full tile burst against NiB and a
// separate Bilde, and nobody wants a gallery of 121 near-identical images.
export const FLYFOTO_BATCH_MAX = 8;

// Extra breathing room when framing a single funn, on top of the chrome.
const FUNN_MARGIN_PX = 90;

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

// Attachment filenames go into a download dialog eventually, so keep them to
// something a filesystem and a URL both accept.
const sanitizeFilename = (s: string) =>
  s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || 'bilde';

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
 * survived only because Layout keyed it on `locality.id`. Splitting the
 * surface into a ribbon strip, a dock column and a pair of dialogs would
 * have scattered that state across siblings — in particular the funn draft,
 * whose pen is armed from the ribbon and whose fields are in the dock, and
 * the flyfoto notice → picker handoff, which is a four-flag conversation
 * between two dialogs.
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
  const setLidarSelection = useSetAtom(lidarExtractSelectionAtom);
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
  // Whether the licensing notice is up in front of the acquisition picker.
  const [flyfotoNotice, setFlyfotoNotice] = useState(false);
  // The style the starter set is fetching, or null when it is not running. A
  // value rather than a bool: the Bilder section names what it is waiting for.
  const [starterStep, setStarterStep] = useState<string | null>(null);
  const starterAbortRef = useRef<AbortController | null>(null);
  // The acquisition picker, opened once the licensing notice is accepted.
  const [flyfotoPicker, setFlyfotoPicker] = useState(false);
  const [flyfotoProjects, setFlyfotoProjects] = useState<
    FlyfotoProject[] | null
  >(null);
  const [flyfotoProjectsError, setFlyfotoProjectsError] = useState(false);
  // Which grab is running: a project id, or MOSAIC for the seamless one.
  // Doubles as the per-row spinner flag, hence a value rather than a bool.
  const [flyfotoBusy, setFlyfotoBusy] = useState<string | null>(null);
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

  // The record went away — deleted here, or by another session.
  useEffect(() => {
    if (
      activeBildeId &&
      attachmentItems &&
      !attachmentItems.some((a) => a.id === activeBildeId)
    ) {
      setActiveBildeId(null);
    }
  }, [activeBildeId, attachmentItems]);

  // Picking a thumbnail *is* "Vis i ruta" (§4.2) — there is no second verb for
  // it. Pressing the active one again puts it down, which is the only way the
  // strip has to mean "nothing", and the images that cannot be placed are
  // exactly the ones with nothing to place.
  const selectBilde = useCallback(
    (id: string | null) => {
      const next = id === activeBildeId ? null : id;
      setActiveBildeId(next);
      const rec = next ? attachmentItems?.find((a) => a.id === next) : null;
      pin(rec && canPinBilde(rec) ? rec.id : null);
    },
    [activeBildeId, attachmentItems, pin],
  );

  // ←/→. Wraps, and never lands on nothing: walking a rail past its end and
  // getting an empty strip would be a worse answer than starting over.
  const stepBilde = useCallback(
    (delta: 1 | -1) => {
      const items = attachmentItems;
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
      pin(canPinBilde(rec) ? rec.id : null);
    },
    [attachmentItems, activeBildeId, pin],
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

  const setBildeCaption = useCallback(
    async (rec: AttachmentRecord, caption: string) => {
      try {
        const updated = await updateAttachmentCaption(rec.id, caption);
        setAttachmentItems((prev) =>
          prev ? prev.map((it) => (it.id === rec.id ? updated : it)) : prev,
        );
      } catch (e) {
        console.warn('[localityWorkspace] caption save failed', e);
        toast.error({ title: t('localities.workspace.saveFailed') });
      }
    },
    [setAttachmentItems, t],
  );

  // Funn draft. `draftFunnId` is the record the pen is bound to — null only
  // until the first shape closes, since drawing autosaves. `draftIsEdit`
  // distinguishes the two ways in: a new funn, or "Rediger tegningen" on one
  // that already exists.
  const [draftFunnId, setDraftFunnId] = useState<string | null>(null);
  const [draftIsEdit, setDraftIsEdit] = useState(false);
  const [funnTitle, setFunnTitle] = useState('');
  const [funnNote, setFunnNote] = useState('');
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
      // A grunnpakke is minutes of tile bursts against two shared upstreams.
      // Closing the lokalitet is as clear a "stop" as there is, and unlike a
      // funn there is nothing half-written to lose — each image is saved
      // whole or not at all.
      starterAbortRef.current?.abort();
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
    setFunnNote('');
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
      // Measured, not guessed: the dock takes a fixed slice of the width and
      // the ribbon an unpredictable slice of the height, and centring the
      // rectangle in the whole canvas puts it half behind both.
      padding: fitPadding(map),
      maxZoom: 18,
      duration: 400,
    });
  }, [map, locality.bbox]);

  // Opening a lokalitet also opens the dock, which takes a column of the map
  // away — frame the rectangle in what is left rather than leaving it half
  // behind the chrome that just appeared.
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
            note: funnNote.trim() || undefined,
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
      funnNote,
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
    setFunnNote('');
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
      setFunnNote(f.note ?? '');
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

  // LiDAR extract seeded with the lokalitet's rectangle — no manual box
  // drag needed inside the workspace (the panel's "tegn på nytt" still
  // allows a custom sub-box).
  const openLidar = useCallback(() => {
    if (draftActive) stopDraft();
    setAdjusting(false);
    const mapProjection = map.getView().getProjection().getCode();
    setLidarSelection({
      bboxMap: transformExtent(locality.bbox, 'EPSG:4326', mapProjection) as [
        number,
        number,
        number,
        number,
      ],
      mapProjection,
      bbox25833: transformExtent(
        locality.bbox,
        'EPSG:4326',
        'EPSG:25833',
      ) as [number, number, number, number],
      bboxLonLat: locality.bbox,
    });
    setTool('lidar');
  }, [
    draftActive,
    stopDraft,
    setAdjusting,
    map,
    locality.bbox,
    setLidarSelection,
    setTool,
  ]);

  const closeLidar = useCallback(() => {
    setTool((cur) => (cur === 'lidar' ? null : cur));
    setLidarSelection(null);
  }, [setTool, setLidarSelection]);

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
    setLidarSelection(null);
  }, [tool, setAdjusting, setLidarSelection]);

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
      setAttachmentItems((prev) => (prev ? [rec, ...prev] : [rec]));
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
        setAttachmentItems((prev) => (prev ? [rec, ...prev] : [rec]));
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

  // One grab: stitch the requested source over the rectangle and keep it
  // as a Bilde. Returns whether an image was saved, so the batch loop can
  // report how many of the projects it tried actually had coverage.
  const grabFlyfoto = useCallback(
    async (
      project?: FlyfotoProject,
      signal?: AbortSignal,
    ): Promise<boolean> => {
      if (!user || !canAdd) return false;
      const label = project
        ? (project.year?.toString() ?? project.projectName)
        : t('localities.tools.flyfotoMosaic');
      try {
        const result = await fetchFlyfoto(locality.bbox, { project, signal });
        if (!result) {
          // An aborted stitch also paints nothing. Saying "no coverage here"
          // about a grab the user cancelled would be a lie about the ground.
          if (signal?.aborted) return false;
          toast.error({
            title: t('localities.tools.flyfotoEmptyFor', { label }),
          });
          return false;
        }
        // JPEG all the way through, like the stitch itself: the caption is
        // large flat type and survives it, and a lossless copy of a
        // lossy-sourced photograph is several times the bytes for nothing.
        const figure = await renderFigureBlob(
          result.canvas,
          flyfotoFigure({
            subject: locality.name || undefined,
            project,
            metresPerPx: result.metresPerPx,
            bbox25833: result.bbox25833,
          }),
          'image/jpeg',
          0.9,
        );
        if (!figure) {
          toast.error({
            title: t('localities.tools.flyfotoFailedFor', { label }),
          });
          return false;
        }
        const rec = await createAttachment(
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
              metresPerPx: result.metresPerPx,
              bbox25833: result.bbox25833,
              imageRect: figure.imageRect,
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
                    // The acquisition's native resolution, not the stitch's:
                    // fetchFlyfoto needs it to plan the same tile grid again,
                    // and metresPerPx above has already been coarsened by the
                    // canvas cap on a large rectangle.
                    projectMetresPerPx: project.metresPerPx,
                    year: project.year,
                    photoDate: project.photoDate,
                  }
                : { nibSource: 'mosaic' }),
            },
          },
          user.id,
          figure.blob,
          'flyfoto.jpg',
        );
        setAttachmentItems((prev) => (prev ? [rec, ...prev] : [rec]));
        return true;
      } catch (e) {
        if (signal?.aborted) return false;
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
      setAttachmentItems,
      t,
      i18n.language,
    ],
  );

  const runFlyfoto = useCallback(
    async (project?: FlyfotoProject) => {
      if (fetchingFlyfoto) return;
      setFlyfotoBusy(project?.id ?? FLYFOTO_MOSAIC);
      setFetchingFlyfoto(true);
      try {
        if (await grabFlyfoto(project)) {
          toast.success({ title: t('localities.tools.flyfotoSaved') });
        }
      } finally {
        setFlyfotoBusy(null);
        setFetchingFlyfoto(false);
      }
    },
    [fetchingFlyfoto, grabFlyfoto, t],
  );

  const runFlyfotoAll = useCallback(async () => {
    if (fetchingFlyfoto || !flyfotoProjects) return;
    const batch = flyfotoProjects.slice(0, FLYFOTO_BATCH_MAX);
    if (batch.length === 0) return;
    setFetchingFlyfoto(true);
    let saved = 0;
    try {
      // Sequential on purpose. A single project's tile burst already
      // saturates the stitcher's concurrency budget against NiB's shared
      // edge, so overlapping two would not finish sooner — it would just
      // make both slower and invite shed responses.
      for (const project of batch) {
        setFlyfotoBusy(project.id);
        if (await grabFlyfoto(project)) saved++;
      }
    } finally {
      setFlyfotoBusy(null);
      setFetchingFlyfoto(false);
    }
    toast.success({
      title: t('localities.tools.flyfotoBatchDone', {
        saved,
        total: batch.length,
      }),
    });
  }, [fetchingFlyfoto, flyfotoProjects, grabFlyfoto, t]);

  // The starter set's rasters land as `extract` attachments, same as when one
  // is produced by hand from the extract tool: a laser-derived picture of the
  // rectangle is what that kind means. The meta is the same set of keys too,
  // so nothing downstream has to know which route produced an image.
  const saveStarterRaster = useCallback(
    async (raster: StarterRaster, caption: string, filename: string) => {
      if (!user) return;
      const rec = await createAttachment(
        {
          locality: locality.id,
          kind: 'extract',
          caption,
          meta: {
            sourceKey: raster.sourceKey,
            sourceLabel: raster.sourceLabel,
            style: raster.style,
            model: raster.model,
            metresPerPx: raster.metresPerPx,
            bbox25833: raster.bbox25833,
            imageRect: raster.imageRect,
          },
        },
        user.id,
        raster.blob,
        filename,
      );
      setAttachmentItems((prev) => (prev ? [rec, ...prev] : [rec]));
    },
    [user, locality.id, setAttachmentItems],
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
   * Sequential, like the flyfoto batch and for the same reason: one stitch
   * already saturates its concurrency budget against a shared public edge,
   * so running them together would not finish sooner, it would just invite
   * shed responses.
   *
   * Each image is independently fallible — so failures are counted, not
   * thrown, and the toast says how many of the planned set arrived.
   */
  const runStarterPack = useCallback(async () => {
    if (!user || !canAdd || starterStep) return;
    const ac = new AbortController();
    starterAbortRef.current = ac;
    const bbox25833 = transformExtent(
      locality.bbox,
      'EPSG:4326',
      'EPSG:25833',
    ) as [number, number, number, number];
    let saved = 0;

    try {
      // The catalogue lookup is the first thing that can answer "is there any
      // laser data here at all", and it costs one cached request.
      setStarterStep(STARTER_STYLES[0]);
      const plan = await planStarterPack(locality.bbox);
      if (ac.signal.aborted) return;
      if (!plan) {
        toast.error({ title: t('localities.tools.starterNone') });
        return;
      }

      for (const style of plan.styles) {
        if (ac.signal.aborted) return;
        setStarterStep(style);
        try {
          const extract = await starterExtract(
            plan.source,
            bbox25833,
            style,
            { subject: locality.name || undefined, signal: ac.signal },
          );
          if (extract && !ac.signal.aborted) {
            await saveStarterRaster(
              extract,
              `${extract.sourceLabel} · ${extract.style}`,
              `${sanitizeFilename(extract.sourceLabel)}_${extract.style}.png`,
            );
            saved++;
          }
        } catch (e) {
          if (!ac.signal.aborted) {
            console.warn('[localityWorkspace] starter extract failed', e);
          }
        }
      }

      if (ac.signal.aborted) return;
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
      if (starterAbortRef.current === ac) starterAbortRef.current = null;
      setStarterStep(null);
    }
  }, [
    user,
    canAdd,
    starterStep,
    locality.bbox,
    locality.name,
    saveStarterRaster,
    t,
  ]);

  // The NiB licensing notice, in front of the acquisition picker. The starter
  // set no longer goes through it: it stopped fetching ortofoto, so consent
  // to NiB's terms is no longer being asked of someone who never asked for a
  // photograph (docs/lokalitet-view.md §4.3).
  const openFlyfotoNotice = useCallback(() => setFlyfotoNotice(true), []);
  const closeFlyfotoNotice = useCallback(() => setFlyfotoNotice(false), []);
  const acceptFlyfotoNotice = useCallback(() => {
    setFlyfotoNotice(false);
    setFlyfotoPicker(true);
  }, []);
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
    const note = funnNote.trim();
    if (title.length === 0) {
      setFunnTitle(rec.title);
      return;
    }
    if (title === rec.title && note === (rec.note ?? '')) return;
    saveFunnMeta(rec, title, note);
  }, [findItems, draftFunnId, funnTitle, funnNote, saveFunnMeta]);

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
    },
    onZoomSelected: () => selectedFunnId && zoomToFunn(selectedFunnId),
    // ←/→ walk the filmstrip (§4.3), and only while there is a strip to walk:
    // OpenLayers' KeyboardPan has these keys otherwise, and taking panning
    // away from a map with no images on the edge of it would be a straight
    // loss. The ground deliberately does not move as you step, which is the
    // whole trick — each press is another reading of the same rectangle, in
    // register.
    stripNavigable:
      stripOpen && !draftActive && (attachmentItems?.length ?? 0) > 1,
    onStepBilde: stepBilde,
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
  const bilderCount = attachmentItems?.length ?? 0;
  // Whether the bottom edge has anything to be. Published rather than
  // recomputed at each end, so the row's `Bilder ▾` and the portal in
  // `LocalityRibbon` cannot disagree about whether pressing it does anything.
  //
  // `canAdd` is in it because an empty lokalitet you may add to still wants
  // the edge — that is where the empty line saying so goes, and where the
  // first image will land. An empty one you may *not* add to gets no bar: a
  // reader has no use for a strip that says "run an extract".
  const hasBilder = bilderCount > 0 || starterStep != null || canAdd;
  const kmCount = kulturminner.result
    ? kulturminner.result.truncated
      ? `${kulturminner.result.items.length}+`
      : kulturminner.result.items.length
    : null;

  // The site's own terrain render, for §4.6 — entering Terreng over a
  // lokalitet starts from what its owner was looking at rather than from a
  // default hillshade at 315°/35°.
  //
  // The cover is the first non-hidden image in `sort` order (§4.4) and is
  // computed rather than stored; neither `sort` nor `hidden` is written yet
  // — step 8 owns both, and `AttachmentRecord` does not carry them until it
  // does — so the list is newest-first and nothing is concealed, and this is
  // simply the most recent terrain render. Published as
  // an atom because `useTerrainAnalysis` is mounted from row 1, on the far
  // side of the tree from the hook that holds the attachments.
  const coverTerrainSpec = useMemo(() => {
    for (const rec of attachmentItems ?? []) {
      const spec = viewSpecOf(rec);
      if (spec?.kind === 'terrain') return spec;
    }
    return null;
  }, [attachmentItems]);

  useEffect(() => {
    setCoverTerrainSpec(coverTerrainSpec);
    return () => setCoverTerrainSpec(null);
  }, [coverTerrainSpec, setCoverTerrainSpec]);

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
    attachmentItems,
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
    funnNote,
    setFunnNote,
    commitDraftMeta,
    savingFunn,
    funnError,
    startDraft,
    stopDraft,

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
    flyfotoNotice,
    openFlyfotoNotice,
    closeFlyfotoNotice,
    acceptFlyfotoNotice,
    flyfotoPicker,
    closeFlyfotoPicker,
    flyfotoProjects,
    flyfotoProjectsError,
    flyfotoBusy,
    runFlyfoto,
    runFlyfotoAll,

    // the starter set
    starterStep,
    runStarterPack,
  };
};

// What the ribbon row, the dock and the dialogs are handed. Derived
// from the hook rather than declared, so adding a member to the return above
// is all it takes to make it available to every consumer.
export type LocalityWorkspaceApi = ReturnType<typeof useLocalityWorkspace>;
