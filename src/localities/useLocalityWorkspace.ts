import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useCallback, useEffect, useState } from 'react';
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
import { lidarExtractSelectionAtom } from '../lidarExtract/atoms';
import { mapAtom } from '../map/atoms';
import { terrainStandaloneBboxAtom } from '../terrain/atoms';
import { toast } from '../ui';
import {
  activeLocalityAtom,
  adjustingLocalityAtom,
  funnDraftActiveAtom,
  lightboxOpenAtom,
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
import {
  getDrawLayerExtent4326,
  serializeDrawLayer,
} from './serializeDrawLayer';
import { growPromptAtom, ribbonToolAtom, workspaceModeAtom } from './toolAtoms';
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
 * surface into ribbon rows and tray columns would have scattered that state
 * across siblings — in particular the funn draft, whose fields live in one
 * place and whose Save button lives in another, and the flyfoto notice →
 * picker handoff, which is a four-flag conversation between two dialogs.
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
  const lightboxOpen = useAtomValue(lightboxOpenAtom);
  const setLidarSelection = useSetAtom(lidarExtractSelectionAtom);
  const [tool, setTool] = useAtom(ribbonToolAtom);
  const mode = useAtomValue(workspaceModeAtom);
  const [growPrompt, setGrowPrompt] = useAtom(growPromptAtom);
  const setTerrainStandaloneBbox = useSetAtom(terrainStandaloneBboxAtom);
  const [shooting, setShooting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fetchingFlyfoto, setFetchingFlyfoto] = useState(false);
  const [flyfotoNotice, setFlyfotoNotice] = useState(false);
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

  // Funn draft. editingFunnId non-null means the draft is re-editing an
  // existing funn's drawing rather than creating one.
  const [editingFunnId, setEditingFunnId] = useState<string | null>(null);
  const [funnTitle, setFunnTitle] = useState('');
  const [funnNote, setFunnNote] = useState('');
  const [savingFunn, setSavingFunn] = useState(false);
  const [funnError, setFunnError] = useState<string | null>(null);

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
      setDraftActive(false);
      setAdjusting(false);
      setTool(null);
      setLidarSelection(null);
      setSelectedFunnId(null);
      setGrowPrompt(null);
      getDrawLayer()?.getSource()?.clear();
    };
  }, [
    locality.id,
    setDraftActive,
    setAdjusting,
    setTool,
    setLidarSelection,
    setSelectedFunnId,
    setGrowPrompt,
    setTerrainStandaloneBbox,
  ]);

  // The funn draft used to be reset by the whole panel remounting on a
  // lokalitet swap. It no longer does, so clear it here.
  useEffect(() => {
    setEditingFunnId(null);
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
    map
      .getView()
      .fit(extent, { padding: [80, 80, 80, 80], maxZoom: 18, duration: 400 });
  }, [map, locality.bbox]);

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

  const cancelDraft = useCallback(() => {
    getDrawLayer()?.getSource()?.clear();
    if (editingFunnId) {
      // Restore the hidden persisted copy.
      const rec = findItems?.find((it) => it.id === editingFunnId);
      if (rec) upsertFunnOnLayer(rec);
      setEditingFunnId(null);
    }
    setDraftActive(false);
  }, [editingFunnId, findItems, setDraftActive]);

  const startDraft = useCallback(() => {
    if (!isMine || draftActive) return;
    // Leftovers on the shared draw layer can only be an abandoned draft;
    // drop them so the new funn starts clean.
    getDrawLayer()?.getSource()?.clear();
    setAdjusting(false);
    // Only the extract is dismissed — terrain is a read-only view of the
    // same rectangle and there is no reason drawing on top should close it.
    setTool((cur) => (cur === 'lidar' ? null : cur));
    setLidarSelection(null);
    setEditingFunnId(null);
    setFunnTitle('');
    setFunnNote('');
    setFunnError(null);
    setDraftActive(true);
  }, [
    isMine,
    draftActive,
    setAdjusting,
    setTool,
    setLidarSelection,
    setDraftActive,
  ]);

  const startGeometryEdit = useCallback(
    (f: LocalityFindRecord) => {
      getDrawLayer()?.getSource()?.clear();
      setAdjusting(false);
      setTool((cur) => (cur === 'lidar' ? null : cur));
      setDrawLayerFeatures(f.geometry, 'EPSG:4326', true);
      hideFunnOnLayer(f.id);
      setEditingFunnId(f.id);
      setFunnTitle(f.title);
      setFunnNote(f.note ?? '');
      setFunnError(null);
      setDraftActive(true);
    },
    [setAdjusting, setTool, setDrawLayerFeatures, setDraftActive],
  );

  const performSave = useCallback(
    async (grownBbox: LocalityBbox | null) => {
      setFunnError(null);
      const projection = map.getView().getProjection().getCode();
      const geometry = serializeDrawLayer(projection);
      if (!geometry) {
        setFunnError(t('localities.funn.draft.noGeometry'));
        return;
      }
      if (!user) return;

      if (grownBbox && !(await patchLocality({ bbox: grownBbox }))) return;

      setSavingFunn(true);
      try {
        const saved: LocalityFindRecord = editingFunnId
          ? await updateLocalityFind(editingFunnId, {
              title: funnTitle.trim(),
              note: funnNote.trim(),
              geometry,
            })
          : await createLocalityFind(
              {
                locality: locality.id,
                title: funnTitle.trim(),
                note: funnNote.trim() || undefined,
                geometry,
              },
              user.id,
            );
        setFindItems((prev) => {
          if (!prev) return [saved];
          return prev.some((it) => it.id === saved.id)
            ? prev.map((it) => (it.id === saved.id ? saved : it))
            : [...prev, saved];
        });
        upsertFunnOnLayer(saved);
        getDrawLayer()?.getSource()?.clear();
        setSelectedFunnId(saved.id);
        setEditingFunnId(null);
        setDraftActive(false);
      } catch (e) {
        console.warn('[localityWorkspace] funn save failed', e);
        setFunnError(t('localities.funn.saveFailed'));
      } finally {
        setSavingFunn(false);
      }
    },
    [
      map,
      t,
      user,
      patchLocality,
      editingFunnId,
      funnTitle,
      funnNote,
      locality.id,
      setFindItems,
      setSelectedFunnId,
      setDraftActive,
    ],
  );

  // A lokalitet holds the entire extent of its funn — offer to grow the
  // rectangle when the drawing sticks out.
  const saveDraft = useCallback(() => {
    const projection = map.getView().getProjection().getCode();
    const drawn = getDrawLayerExtent4326(projection);
    if (drawn && !bboxContains(locality.bbox, drawn)) {
      setGrowPrompt(bboxUnion(locality.bbox, drawn));
      return;
    }
    performSave(null);
  }, [map, locality.bbox, setGrowPrompt, performSave]);

  const confirmGrow = useCallback(() => {
    const bbox = growPrompt;
    setGrowPrompt(null);
    if (bbox) performSave(bbox);
  }, [growPrompt, setGrowPrompt, performSave]);

  const cancelGrow = useCallback(() => setGrowPrompt(null), [setGrowPrompt]);

  // LiDAR extract seeded with the lokalitet's rectangle — no manual box
  // drag needed inside the workspace (the panel's "tegn på nytt" still
  // allows a custom sub-box).
  const openLidar = useCallback(() => {
    if (draftActive) cancelDraft();
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
    cancelDraft,
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

  // Terreng takes over the surface like the extract does, so the two are
  // mutually exclusive.
  const toggleTerrain = useCallback(() => {
    if (tool === 'terrain') {
      setTool(null);
      return;
    }
    if (draftActive) cancelDraft();
    setAdjusting(false);
    setLidarSelection(null);
    setTool('terrain');
  }, [
    tool,
    draftActive,
    cancelDraft,
    setAdjusting,
    setLidarSelection,
    setTool,
  ]);

  const toggleAdjusting = useCallback(() => {
    if (!adjusting && draftActive) cancelDraft();
    setAdjusting(!adjusting);
  }, [adjusting, draftActive, cancelDraft, setAdjusting]);

  // Capture the current view cropped to the rectangle → Bilder.
  const takeScreenshot = useCallback(async () => {
    if (!user || !isMine || shooting) return;
    setShooting(true);
    try {
      const blob = await captureLocalityScreenshot(map, locality.bbox);
      if (!blob) {
        toast.error({ title: t('localities.tools.screenshotFailed') });
        return;
      }
      const rec = await createAttachment(
        {
          locality: locality.id,
          kind: 'screenshot',
          caption: `${t('localities.tools.screenshotCaption')} ${new Date().toLocaleDateString(i18n.language)}`,
        },
        user.id,
        blob,
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
    locality.bbox,
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
    async (project?: FlyfotoProject): Promise<boolean> => {
      if (!user || !isMine) return false;
      const label = project
        ? (project.year?.toString() ?? project.projectName)
        : t('localities.tools.flyfotoMosaic');
      try {
        const result = await fetchFlyfoto(locality.bbox, { project });
        if (!result) {
          toast.error({
            title: t('localities.tools.flyfotoEmptyFor', { label }),
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
          result.blob,
          'flyfoto.jpg',
        );
        setAttachmentItems((prev) => (prev ? [rec, ...prev] : [rec]));
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
      isMine,
      locality.id,
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

  // Notice → picker.
  const openFlyfotoNotice = useCallback(() => setFlyfotoNotice(true), []);
  const closeFlyfotoNotice = useCallback(() => setFlyfotoNotice(false), []);
  const openFlyfotoPicker = useCallback(() => {
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
      padding: [120, 120, 120, 120],
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

  const removeFunn = useCallback(
    async (f: LocalityFindRecord) => {
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
    [setFindItems, selectedFunnId, setSelectedFunnId, t],
  );

  useWorkspaceKeys({
    enabled: !lightboxOpen && growPrompt == null,
    navigable: mode === 'browse',
    draftActive,
    onNewFunn: startDraft,
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
    editingFunnId,
    funnTitle,
    setFunnTitle,
    funnNote,
    setFunnNote,
    savingFunn,
    funnError,
    startDraft,
    cancelDraft,
    saveDraft,

    // grow-to-fit
    growPrompt,
    confirmGrow,
    cancelGrow,

    // tools
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
    flyfotoPicker,
    openFlyfotoPicker,
    closeFlyfotoPicker,
    flyfotoProjects,
    flyfotoProjectsError,
    flyfotoBusy,
    runFlyfoto,
    runFlyfotoAll,
  };
};

// What the ribbon rows, the tray columns and the dialogs are handed. Derived
// from the hook rather than declared, so adding a member to the return above
// is all it takes to make it available to every consumer.
export type LocalityWorkspaceApi = ReturnType<typeof useLocalityWorkspace>;
