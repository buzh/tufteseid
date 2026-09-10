import type { FeatureCollection } from 'geojson';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createAttachment } from '../api/attachments';
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
import { currentUserAtom } from '../auth/atoms';
import { useDrawSettings } from '../draw/drawControls/hooks/drawSettings';
import { getDrawLayer } from '../draw/drawControls/hooks/mapLayers';
import { renderFigureBlob } from '../figure/figure';
import { flyfotoFigure, screenshotFigure } from '../figure/specs';
import { lidarExtractSelectionAtom } from '../lidarExtract/atoms';
import { mapAtom } from '../map/atoms';
import { activeThemeLayersAtom } from '../map/layers/atoms';
import type { BackgroundLayerName } from '../map/layers/backgroundLayers';
import {
  backgroundLayerAtom,
  hybridOverlayAtom,
} from '../map/layers/config/backgroundLayers/atoms';
import { fitPadding } from '../shell/chromeInsets';
import { terrainStandaloneBboxAtom } from '../terrain/atoms';
import { toast } from '../ui';
import {
  activeLocalityAtom,
  adjustingLocalityAtom,
  funnDraftActiveAtom,
  lightboxOpenAtom,
  marksHiddenAtom,
  selectedFunnIdAtom,
} from './atoms';
import { fetchFlyfoto } from './flyfoto';
import {
  fetchFlyfotoProjectsForBbox,
  type FlyfotoProject,
} from './flyfotoProjects';
import { formatBboxArea } from './format';
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
  STARTER_STEPS,
  starterExtract,
  starterTerrain,
  type StarterRaster,
  type StarterStep,
} from './starterPack';
import { funnOutsideAtom, ribbonToolAtom, workspaceModeAtom } from './toolAtoms';
import { useFunnAutosave } from './useFunnAutosave';
import { useKulturminner } from './useKulturminner';
import { useLocalityAdjust } from './useLocalityAdjust';
import {
  useLocalityAttachments,
  useLocalityFinds,
} from './useLocalityContent';
import { useWorkspaceKeys } from './useWorkspaceKeys';

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

// What the NiB licensing notice is standing in front of. Both paths grab the
// same imagery, so both are gated; only the continuation differs.
export type FlyfotoNoticeFor = 'picker' | 'starter';

// How many images a full grunnpakke is, for the "n of m" it reports.
const STARTER_TOTAL = STARTER_STEPS.length;

// What the ground was, for the screenshot figure's source line. Keyed on the
// background layer rather than asked of useGroundMode, which needs the whole
// LiDAR + flyfoto control surface mounted to answer the same question.
const GROUND_LABEL_KEY: Record<BackgroundLayerName, string> = {
  topo: 'ribbon.mode.standard',
  empty: 'ribbon.mode.standard',
  lidarHillshade: 'ribbon.mode.lidar',
  lidarProject: 'ribbon.mode.lidar',
  flyfoto: 'ribbon.mode.flyfoto',
  flyfotoProject: 'ribbon.mode.flyfoto',
  // Never the value of backgroundLayerAtom — hybrid is a modifier — but the
  // union has to be covered.
  topoOverlay: 'ribbon.mode.hybrid',
};

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
  const setActiveLocality = useSetAtom(activeLocalityAtom);
  const [draftActive, setDraftActive] = useAtom(funnDraftActiveAtom);
  const [adjusting, setAdjusting] = useAtom(adjustingLocalityAtom);
  const [selectedFunnId, setSelectedFunnId] = useAtom(selectedFunnIdAtom);
  const setMarksHidden = useSetAtom(marksHiddenAtom);
  const lightboxOpen = useAtomValue(lightboxOpenAtom);
  const setLidarSelection = useSetAtom(lidarExtractSelectionAtom);
  const [tool, setTool] = useAtom(ribbonToolAtom);
  const mode = useAtomValue(workspaceModeAtom);
  const [funnOutside, setFunnOutside] = useAtom(funnOutsideAtom);
  const setTerrainStandaloneBbox = useSetAtom(terrainStandaloneBboxAtom);
  // Read only so a screenshot can say whose pixels are in it.
  const background = useAtomValue(backgroundLayerAtom);
  const hybrid = useAtomValue(hybridOverlayAtom);
  const themeLayers = useAtomValue(activeThemeLayersAtom);
  const [shooting, setShooting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fetchingFlyfoto, setFetchingFlyfoto] = useState(false);
  // Which action the licensing notice is gating, or null when it is down.
  const [flyfotoNotice, setFlyfotoNotice] = useState<FlyfotoNoticeFor | null>(
    null,
  );
  // The step the starter pack is on, or null when it is not running. A value
  // rather than a bool: the Bilder section names what it is waiting for.
  const [starterStep, setStarterStep] = useState<StarterStep | null>(null);
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

  const isMine = user != null && user.id === locality.owner;

  // Mounts the move/resize interactions while adjustingLocalityAtom is
  // set; persists the bbox after every finished gesture.
  useLocalityAdjust(locality);

  const { items: findItems, setItems: setFindItems } = useLocalityFinds(
    locality.id,
  );
  const { items: attachmentItems, setItems: setAttachmentItems } =
    useLocalityAttachments(locality.id);
  const kulturminner = useKulturminner(locality.bbox);

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
    if (!isMine || draftActive) return;
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
    isMine,
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
  // Entering is normally row 1's job now (it owns all five ground modes) and
  // arrives as a plain write to ribbonToolAtom — hence the effect below
  // rather than cleanup inlined here. This is the way *out*, from the dock.
  const toggleTerrain = useCallback(() => {
    setTool((cur) => (cur === 'terrain' ? null : 'terrain'));
  }, [setTool]);

  useEffect(() => {
    if (tool !== 'terrain') return;
    setAdjusting(false);
    setLidarSelection(null);
  }, [tool, setAdjusting, setLidarSelection]);

  const toggleAdjusting = useCallback(() => {
    if (!adjusting && draftActive) stopDraft();
    setAdjusting(!adjusting);
  }, [adjusting, draftActive, stopDraft, setAdjusting]);

  // Capture the current view cropped to the rectangle → Bilder.
  const takeScreenshot = useCallback(async () => {
    if (!user || !isMine || shooting) return;
    setShooting(true);
    try {
      const shot = await captureLocalityScreenshot(map, locality.bbox);
      if (!shot) {
        toast.error({ title: t('localities.tools.screenshotFailed') });
        return;
      }
      // Hybrid is a LiDAR stack with names on it, so it credits the same
      // way; the label is the only thing that differs.
      const figure = await renderFigureBlob(
        shot.canvas,
        screenshotFigure({
          subject: locality.name || undefined,
          groundLabel: t(
            hybrid ? 'ribbon.mode.hybrid' : GROUND_LABEL_KEY[background],
          ),
          groundIsFlyfoto: NIB_GROUNDS.has(background),
          themeLayers: [...themeLayers],
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
    isMine,
    shooting,
    map,
    locality.id,
    locality.name,
    locality.bbox,
    background,
    hybrid,
    themeLayers,
    setAttachmentItems,
    t,
    i18n.language,
  ]);

  // Upload lives here rather than in the Bilder column because the same
  // verb is on the lokalitet ribbon row: two copies of the create call
  // would be two places to keep the optimistic list update right.
  const uploadFile = useCallback(
    async (file: File) => {
      if (!user || !isMine || uploading) return;
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
    [user, isMine, uploading, locality.id, setAttachmentItems, t],
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
      if (!user || !isMine) return false;
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
              ...(project
                ? {
                    projectName: project.projectName,
                    year: project.year,
                    photoDate: project.photoDate,
                  }
                : {}),
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
      isMine,
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

  // The acquisition list, fetched if the picker has not already done it.
  // Shares the same state, so opening the picker after a grunnpakke shows the
  // list instantly — and wmscache fronts the query in any case.
  const ensureFlyfotoProjects = useCallback(async (): Promise<
    FlyfotoProject[]
  > => {
    if (flyfotoProjects) return flyfotoProjects;
    try {
      const list = await fetchFlyfotoProjectsForBbox(locality.bbox);
      setFlyfotoProjects(list);
      return list;
    } catch (e) {
      console.warn('[localityWorkspace] flyfoto project list failed', e);
      setFlyfotoProjectsError(true);
      setFlyfotoProjects([]);
      return [];
    }
  }, [flyfotoProjects, locality.bbox]);

  // The two derived rasters — LiDAR extract and terrain render — land as
  // `extract` attachments, same as when they are produced by hand: both are
  // laser-derived pictures of the rectangle, which is what that kind means.
  const saveStarterRaster = useCallback(
    async (raster: StarterRaster, caption: string, filename: string) => {
      if (!user) return;
      const rec = await createAttachment(
        {
          locality: locality.id,
          kind: 'extract',
          caption,
          meta: {
            sourceLabel: raster.sourceLabel,
            style: raster.style,
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
   * The one-press starter set: newest ortofoto, best LiDAR hillshade, a
   * multidirectional relief render. Three things you would fetch by hand
   * anyway, in the order you would want to look at them.
   *
   * Sequential, like the flyfoto batch and for the same reason: one stitch
   * already saturates its concurrency budget against a shared public edge,
   * and these hit two different ones (NiB, then Kartverket twice). Running
   * them together would not finish sooner, it would just invite shed
   * responses from both.
   *
   * Each step is independently fallible. A rectangle at the coast can easily
   * have ortofoto and no laser data, and reporting that as a failed pack
   * would be wrong — so failures are counted, not thrown, and the toast says
   * how many of the three arrived.
   */
  const runStarterPack = useCallback(async () => {
    if (!user || !isMine || starterStep || fetchingFlyfoto) return;
    const ac = new AbortController();
    starterAbortRef.current = ac;
    const bbox25833 = transformExtent(
      locality.bbox,
      'EPSG:4326',
      'EPSG:25833',
    ) as [number, number, number, number];
    let saved = 0;

    try {
      setStarterStep('flyfoto');
      // The list is newest-first; with nothing in it, `undefined` falls
      // through to the seamless best-available mosaic.
      const projects = await ensureFlyfotoProjects();
      if (ac.signal.aborted) return;
      // Same flag the picker sets, so a pack and a hand-picked grab can never
      // both be stitching against the NiB edge at once.
      setFetchingFlyfoto(true);
      try {
        if (await grabFlyfoto(projects[0], ac.signal)) saved++;
      } finally {
        setFetchingFlyfoto(false);
      }

      if (ac.signal.aborted) return;
      setStarterStep('extract');
      try {
        const extract = await starterExtract(locality.bbox, bbox25833, {
          subject: locality.name || undefined,
          signal: ac.signal,
        });
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

      if (ac.signal.aborted) return;
      setStarterStep('terrain');
      try {
        const terrain = await starterTerrain(
          locality.bbox,
          t('localities.terrain.sourceLabel'),
          { subject: locality.name || undefined, signal: ac.signal },
        );
        if (terrain && !ac.signal.aborted) {
          await saveStarterRaster(
            terrain,
            `${t(`localities.terrain.vis.${terrain.style}`)} · DTM`,
            `terreng_${terrain.style}_dtm.png`,
          );
          saved++;
        }
      } catch (e) {
        if (!ac.signal.aborted) {
          console.warn('[localityWorkspace] starter terrain failed', e);
        }
      }

      if (ac.signal.aborted) return;
      if (saved === 0) {
        toast.error({ title: t('localities.tools.starterNone') });
      } else {
        toast.success({
          title: t('localities.tools.starterDone', {
            saved,
            total: STARTER_TOTAL,
          }),
        });
      }
    } finally {
      if (starterAbortRef.current === ac) starterAbortRef.current = null;
      setStarterStep(null);
    }
  }, [
    user,
    isMine,
    starterStep,
    fetchingFlyfoto,
    locality.bbox,
    locality.name,
    ensureFlyfotoProjects,
    grabFlyfoto,
    saveStarterRaster,
    t,
  ]);

  // Notice → whichever grab asked for it. Both take the same imagery from
  // the same service, so both go through the same gate; only what happens on
  // "Fortsett" differs.
  const openFlyfotoNotice = useCallback(() => setFlyfotoNotice('picker'), []);
  const openStarterNotice = useCallback(() => setFlyfotoNotice('starter'), []);
  const closeFlyfotoNotice = useCallback(() => setFlyfotoNotice(null), []);
  const acceptFlyfotoNotice = useCallback(() => {
    const pending = flyfotoNotice;
    setFlyfotoNotice(null);
    if (pending === 'picker') setFlyfotoPicker(true);
    else if (pending === 'starter') void runStarterPack();
  }, [flyfotoNotice, runStarterPack]);
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
    enabled: !lightboxOpen,
    navigable: mode !== 'draft',
    draftActive,
    // Same toggle as the row-2 button the key is advertised on: N puts the
    // pen down again rather than doing nothing the second time.
    onNewFunn: () => (draftActive ? stopDraft() : startDraft()),
    onToggleLidar: toggleLidar,
    onScreenshot: takeScreenshot,
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
    onEscape: () => {
      if (mode === 'lidar') closeLidar();
      else if (adjusting) setAdjusting(false);
      else if (selectedFunnId) setSelectedFunnId(null);
      else setActiveLocality(null);
    },
  });

  const funnCount = findItems?.length ?? 0;
  const bilderCount = attachmentItems?.length ?? 0;
  const kmCount = kulturminner.result
    ? kulturminner.result.truncated
      ? `${kulturminner.result.items.length}+`
      : kulturminner.result.items.length
    : null;

  const summary = [
    funnCount > 0 ? t('localities.summary.funn', { count: funnCount }) : null,
    bilderCount > 0
      ? t('localities.summary.bilder', { count: bilderCount })
      : null,
    formatBboxArea(locality.bbox, i18n.language),
    !isMine && locality.expand?.owner
      ? t('localities.byOwner', { name: locality.expand.owner.name })
      : null,
  ].filter((s): s is string => !!s);

  return {
    // identity / permissions
    locality,
    user,
    isMine,
    mode,
    close,
    rename,
    zoomToLocality,
    removeLocality,
    patchLocality,

    // content
    findItems,
    attachmentItems,
    setAttachmentItems,
    kulturminner,
    funnCount,
    bilderCount,
    kmCount,
    summary,

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
    toggleTerrain,
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

    // grunnpakke
    starterStep,
    openStarterNotice,
  };
};

// What the ribbon row, the dock and the dialogs are handed. Derived
// from the hook rather than declared, so adding a member to the return above
// is all it takes to make it available to every consumer.
export type LocalityWorkspaceApi = ReturnType<typeof useLocalityWorkspace>;
