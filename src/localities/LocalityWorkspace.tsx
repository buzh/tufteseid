import {
  Badge,
  Box,
  Button,
  Dialog,
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  Flex,
  Heading,
  HStack,
  IconButton,
  Input,
  MaterialSymbol,
  Stack,
  Text,
  toaster,
  Tooltip,
} from '@kvib/react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react';
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
import { LidarExtractPanel } from '../lidarExtract/LidarExtractPanel';
import { mapAtom } from '../map/atoms';
import {
  activeLocalityAtom,
  adjustingLocalityAtom,
  funnDraftActiveAtom,
  lightboxOpenAtom,
  selectedFunnIdAtom,
} from './atoms';
import { BilderSection } from './BilderSection';
import { formatBboxArea } from './format';
import { FunnDraft } from './FunnDraft';
import { FunnList } from './FunnList';
import {
  getFunnExtentOnLayer,
  hideFunnOnLayer,
  removeFunnFromLayer,
  upsertFunnOnLayer,
} from './funnLayer';
import { KulturminnerSection } from './KulturminnerSection';
import { LocalityDetails } from './LocalityDetails';
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
import { BadgePalette, ConfirmPopover, WorkspaceSection } from './ui';
import { useKulturminner } from './useKulturminner';
import { useLocalityAdjust } from './useLocalityAdjust';
import {
  useLocalityAttachments,
  useLocalityFinds,
} from './useLocalityContent';
import { useWorkspaceKeys } from './useWorkspaceKeys';

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

const VISIBILITY_PALETTE: Record<
  LocalityRecord['visibility'],
  BadgePalette
> = {
  private: 'gray',
  limited: 'yellow',
  public: 'green',
};

// One verb per button, always in the same place regardless of how far
// down the panel is scrolled. Before this the tools lived in a section at
// the very bottom, below Funn, Bilder and the register readout.
const ActionButton = ({
  icon,
  label,
  tooltip,
  active,
  disabled,
  onClick,
}: {
  icon: MaterialSymbol;
  label: string;
  tooltip: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <Tooltip content={tooltip} positioning={{ placement: 'bottom' }}>
    <Button
      size="xs"
      flex="1"
      minW={0}
      px={1.5}
      leftIcon={icon}
      variant={active ? 'primary' : 'secondary'}
      colorPalette="green"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
    >
      <Text fontSize="11px" lineClamp={1}>
        {label}
      </Text>
    </Button>
  </Tooltip>
);

export const LocalityWorkspace = ({
  locality,
}: {
  locality: LocalityRecord;
}) => {
  const { t, i18n } = useTranslation();
  const map = useAtomValue(mapAtom);
  const user = useAtomValue(currentUserAtom);
  const setActiveLocality = useSetAtom(activeLocalityAtom);
  const [draftActive, setDraftActive] = useAtom(funnDraftActiveAtom);
  const [adjusting, setAdjusting] = useAtom(adjustingLocalityAtom);
  const [selectedFunnId, setSelectedFunnId] = useAtom(selectedFunnIdAtom);
  const lightboxOpen = useAtomValue(lightboxOpenAtom);
  const setLidarSelection = useSetAtom(lidarExtractSelectionAtom);
  const [lidarOpen, setLidarOpen] = useState(false);
  const [shooting, setShooting] = useState(false);
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

  // Fresh records open straight into the rename field (creation flow:
  // drag first, name after).
  const isFreshRecord = locality.name === t('localities.defaultName');
  const [renaming, setRenaming] = useState(isFreshRecord);
  const [name, setName] = useState(locality.name);

  // Funn draft. editingFunnId non-null means the draft is re-editing an
  // existing funn's drawing rather than creating one.
  const [editingFunnId, setEditingFunnId] = useState<string | null>(null);
  const [funnTitle, setFunnTitle] = useState('');
  const [funnNote, setFunnNote] = useState('');
  const [savingFunn, setSavingFunn] = useState(false);
  const [funnError, setFunnError] = useState<string | null>(null);
  const [growPrompt, setGrowPrompt] = useState<LocalityBbox | null>(null);

  useEffect(() => {
    setLocalityHighlight(locality.id);
    return () => setLocalityHighlight(null);
  }, [locality.id]);

  // Draft/adjust/lidar/selection cleanup when the workspace closes or
  // swaps lokalitet.
  useEffect(() => {
    return () => {
      setDraftActive(false);
      setAdjusting(false);
      setLidarSelection(null);
      setSelectedFunnId(null);
      getDrawLayer()?.getSource()?.clear();
    };
  }, [
    locality.id,
    setDraftActive,
    setAdjusting,
    setLidarSelection,
    setSelectedFunnId,
  ]);

  const patchLocality = useCallback(
    async (patch: LocalityPatch) => {
      try {
        const updated = await updateLocality(locality.id, patch);
        upsertLocalityOnLayer(updated);
        setActiveLocality(updated);
        return updated;
      } catch (e) {
        console.warn('[LocalityWorkspace] save failed', e);
        toaster.error({ title: t('localities.workspace.saveFailed') });
        return null;
      }
    },
    [locality.id, setActiveLocality, t],
  );

  const commitName = async () => {
    setRenaming(false);
    const next = name.trim();
    if (next.length === 0 || next === locality.name) {
      setName(locality.name);
      return;
    }
    await patchLocality({ name: next });
  };

  const zoomToLocality = () => {
    const projection = map.getView().getProjection().getCode();
    const extent = transformExtent(locality.bbox, 'EPSG:4326', projection);
    map
      .getView()
      .fit(extent, { padding: [80, 80, 80, 80], maxZoom: 18, duration: 400 });
  };

  const removeLocality = async () => {
    try {
      await deleteLocality(locality.id);
      removeLocalityFromLayer(locality.id);
      setActiveLocality(null);
    } catch (e) {
      console.warn('[LocalityWorkspace] delete failed', e);
      toaster.error({ title: t('localities.workspace.saveFailed') });
    }
  };

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
    setLidarOpen(false);
    setLidarSelection(null);
    setEditingFunnId(null);
    setFunnTitle('');
    setFunnNote('');
    setFunnError(null);
    setDraftActive(true);
  }, [isMine, draftActive, setAdjusting, setLidarSelection, setDraftActive]);

  const startGeometryEdit = (f: LocalityFindRecord) => {
    getDrawLayer()?.getSource()?.clear();
    setAdjusting(false);
    setLidarOpen(false);
    setDrawLayerFeatures(f.geometry, 'EPSG:4326', true);
    hideFunnOnLayer(f.id);
    setEditingFunnId(f.id);
    setFunnTitle(f.title);
    setFunnNote(f.note ?? '');
    setFunnError(null);
    setDraftActive(true);
  };

  const performSave = async (grownBbox: LocalityBbox | null) => {
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
      console.warn('[LocalityWorkspace] funn save failed', e);
      setFunnError(t('localities.funn.saveFailed'));
    } finally {
      setSavingFunn(false);
    }
  };

  // A lokalitet holds the entire extent of its funn — offer to grow the
  // rectangle when the drawing sticks out.
  const saveDraft = () => {
    const projection = map.getView().getProjection().getCode();
    const drawn = getDrawLayerExtent4326(projection);
    if (drawn && !bboxContains(locality.bbox, drawn)) {
      setGrowPrompt(bboxUnion(locality.bbox, drawn));
      return;
    }
    performSave(null);
  };

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
    setLidarOpen(true);
  }, [
    draftActive,
    cancelDraft,
    setAdjusting,
    map,
    locality.bbox,
    setLidarSelection,
  ]);

  const closeLidar = useCallback(() => {
    setLidarOpen(false);
    setLidarSelection(null);
  }, [setLidarSelection]);

  // Capture the current view cropped to the rectangle → Bilder.
  const takeScreenshot = useCallback(async () => {
    if (!user || !isMine || shooting) return;
    setShooting(true);
    try {
      const blob = await captureLocalityScreenshot(map, locality.bbox);
      if (!blob) {
        toaster.error({ title: t('localities.tools.screenshotFailed') });
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
      toaster.success({ title: t('localities.tools.screenshotSaved') });
    } catch (e) {
      console.warn('[LocalityWorkspace] screenshot failed', e);
      toaster.error({ title: t('localities.tools.screenshotFailed') });
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

  const selectFunn = (f: LocalityFindRecord) => {
    setSelectedFunnId(f.id);
    zoomToFunn(f.id);
  };

  const changeStatus = async (
    f: LocalityFindRecord,
    status: LocalityFindStatus,
  ) => {
    try {
      const updated = await updateLocalityFind(f.id, { status });
      setFindItems((prev) =>
        prev ? prev.map((it) => (it.id === f.id ? updated : it)) : prev,
      );
    } catch (e) {
      console.warn('[LocalityWorkspace] status update failed', e);
      toaster.error({ title: t('localities.funn.saveFailed') });
    }
  };

  const saveFunnMeta = async (
    f: LocalityFindRecord,
    title: string,
    note: string,
  ) => {
    try {
      const updated = await updateLocalityFind(f.id, { title, note });
      setFindItems((prev) =>
        prev ? prev.map((it) => (it.id === f.id ? updated : it)) : prev,
      );
    } catch (e) {
      console.warn('[LocalityWorkspace] funn update failed', e);
      toaster.error({ title: t('localities.funn.saveFailed') });
    }
  };

  const removeFunn = async (f: LocalityFindRecord) => {
    try {
      await deleteLocalityFind(f.id);
      removeFunnFromLayer(f.id);
      setFindItems((prev) =>
        prev ? prev.filter((it) => it.id !== f.id) : prev,
      );
      if (selectedFunnId === f.id) setSelectedFunnId(null);
    } catch (e) {
      console.warn('[LocalityWorkspace] funn delete failed', e);
      toaster.error({ title: t('localities.funn.saveFailed') });
    }
  };

  const mode = draftActive ? 'draft' : lidarOpen ? 'lidar' : 'browse';

  useWorkspaceKeys({
    enabled: !lightboxOpen && growPrompt == null,
    navigable: mode === 'browse',
    draftActive,
    onNewFunn: startDraft,
    onToggleLidar: () => (lidarOpen ? closeLidar() : openLidar()),
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
      if (lidarOpen) closeLidar();
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

  return (
    <Stack
      width="100%"
      maxHeight="calc(100vh - 80px)"
      pointerEvents="auto"
      bg="white"
      shadow="lg"
      m={{ base: 0, md: 1 }}
      mr={{ base: 0, md: 3 }}
      borderRadius="16px"
      overflowY="auto"
      gap={0}
    >
      {/* Header */}
      <Stack gap={1} px={4} pt={3} pb={2}>
        <Flex align="center" gap={1}>
          <IconButton
            icon="arrow_back"
            variant="ghost"
            size="sm"
            aria-label={t('localities.workspace.back')}
            onClick={() => setActiveLocality(null)}
          />
          {renaming && isMine ? (
            <Input
              size="sm"
              flex="1"
              value={name}
              autoFocus
              maxLength={200}
              placeholder={t('localities.workspace.namePlaceholder')}
              onFocus={(e: ReactFocusEvent<HTMLInputElement>) =>
                e.target.select()
              }
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') {
                  setName(locality.name);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <Heading
              size="sm"
              flex="1"
              lineClamp={1}
              cursor={isMine ? 'text' : undefined}
              title={isMine ? t('localities.workspace.renameHint') : undefined}
              onClick={() => isMine && setRenaming(true)}
            >
              {locality.name}
            </Heading>
          )}
          <Tooltip content={t('localities.workspace.zoom')}>
            <IconButton
              icon="zoom_in_map"
              variant="ghost"
              size="sm"
              aria-label={t('localities.workspace.zoom')}
              onClick={zoomToLocality}
            />
          </Tooltip>
          {isMine && (
            <ConfirmPopover
              title={t('localities.workspace.confirmDelete', {
                name: locality.name,
              })}
              confirmLabel={t('localities.workspace.deleteLocality')}
              onConfirm={removeLocality}
              trigger={
                <IconButton
                  icon="delete"
                  variant="ghost"
                  colorPalette="red"
                  size="sm"
                  aria-label={t('localities.workspace.deleteLocality')}
                />
              }
            />
          )}
        </Flex>

        {/* At-a-glance: what's in here and how big it is, without
            unfolding a section or scrolling. */}
        <Flex align="center" gap={1.5} wrap="wrap" pl={1}>
          <Badge
            colorPalette={VISIBILITY_PALETTE[locality.visibility]}
            size="sm"
          >
            {t(`localities.visibility.${locality.visibility}`)}
          </Badge>
          {summary.length > 0 && (
            <Text fontSize="xs" color="gray.600">
              {summary.join(' · ')}
            </Text>
          )}
        </Flex>
      </Stack>

      {/* Action bar — sticky so the verbs stay reachable at any scroll
          depth. */}
      <Box
        position="sticky"
        top={0}
        zIndex={1}
        bg="white"
        px={4}
        py={2}
        borderTopWidth="1px"
        borderBottomWidth="1px"
        borderColor="gray.100"
      >
        <HStack gap={1}>
          {isMine && (
            <ActionButton
              icon="add"
              label={t('localities.funn.new')}
              tooltip={`${t('localities.funn.new')} (N)`}
              active={mode === 'draft'}
              onClick={() => (draftActive ? cancelDraft() : startDraft())}
            />
          )}
          <ActionButton
            icon="crop_free"
            label={t('localities.tools.lidarExtractShort')}
            tooltip={`${t('localities.tools.lidarExtract')} (U)`}
            active={mode === 'lidar'}
            onClick={() => (lidarOpen ? closeLidar() : openLidar())}
          />
          {isMine && (
            <ActionButton
              icon="photo_camera"
              label={t('localities.tools.screenshotShort')}
              tooltip={`${t('localities.tools.screenshot')} (B)`}
              disabled={shooting}
              onClick={takeScreenshot}
            />
          )}
          {isMine && (
            <ActionButton
              icon="transform"
              label={t('localities.workspace.adjustShort')}
              tooltip={t('localities.workspace.adjust')}
              active={adjusting}
              onClick={() => {
                if (!adjusting && draftActive) cancelDraft();
                setAdjusting(!adjusting);
              }}
            />
          )}
        </HStack>
      </Box>

      {/* Body. Drawing a funn and running an extract each take over the
          panel: both are multi-step and neither wants the section list
          shifting underneath it. */}
      <Box px={4} pt={3} pb={4}>
        {mode === 'draft' && (
          <FunnDraft
            editing={editingFunnId != null}
            title={funnTitle}
            note={funnNote}
            saving={savingFunn}
            error={funnError}
            onTitle={setFunnTitle}
            onNote={setFunnNote}
            onSave={saveDraft}
            onCancel={cancelDraft}
          />
        )}

        {mode === 'lidar' && (
          <Stack gap={2}>
            <Flex justify="space-between" align="center">
              <Text fontSize="sm" fontWeight="bold">
                {t('localities.tools.lidarExtract')}
              </Text>
              <IconButton
                icon="close"
                size="xs"
                variant="ghost"
                aria-label={t('localities.tools.closeLidar')}
                onClick={closeLidar}
              />
            </Flex>
            <LidarExtractPanel />
          </Stack>
        )}

        {mode === 'browse' && (
          <Stack gap={3}>
            <WorkspaceSection
              id="funn"
              title={t('localities.funn.heading')}
              count={funnCount}
              countPalette="green"
            >
              <FunnList
                items={findItems}
                editable={isMine}
                selectedId={selectedFunnId}
                onSelect={selectFunn}
                onStatus={changeStatus}
                onSaveMeta={saveFunnMeta}
                onEditGeometry={startGeometryEdit}
                onDelete={removeFunn}
              />
            </WorkspaceSection>

            <WorkspaceSection
              id="bilder"
              title={t('localities.bilder.heading')}
              count={bilderCount}
            >
              {user && (
                <BilderSection
                  locality={locality}
                  userId={user.id}
                  isMine={isMine}
                  items={attachmentItems}
                  setItems={setAttachmentItems}
                />
              )}
            </WorkspaceSection>

            <WorkspaceSection
              id="kulturminner"
              title={t('localities.kulturminner.heading')}
              count={kmCount}
              countPalette="yellow"
            >
              <KulturminnerSection
                result={kulturminner.result}
                error={kulturminner.error}
              />
            </WorkspaceSection>

            <WorkspaceSection
              id="detaljer"
              title={t('localities.workspace.details')}
            >
              <LocalityDetails
                locality={locality}
                isMine={isMine}
                onPatch={patchLocality}
              />
            </WorkspaceSection>
          </Stack>
        )}
      </Box>

      {/* Grow-to-fit. Used to be a window.confirm in the middle of the
          save. */}
      <Dialog
        open={growPrompt != null}
        placement="center"
        onOpenChange={(e) => !e.open && setGrowPrompt(null)}
      >
        <DialogContent>
          <DialogBody p={5}>
            <Stack gap={4}>
              <Text fontSize="sm">{t('localities.funn.growConfirm')}</Text>
              <HStack justify="flex-end">
                <Button
                  size="sm"
                  variant="tertiary"
                  onClick={() => setGrowPrompt(null)}
                >
                  {t('localities.funn.draft.cancel')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  colorPalette="green"
                  onClick={() => {
                    const bbox = growPrompt;
                    setGrowPrompt(null);
                    if (bbox) performSave(bbox);
                  }}
                >
                  {t('localities.funn.growConfirmAction')}
                </Button>
              </HStack>
            </Stack>
          </DialogBody>
          <DialogCloseTrigger />
        </DialogContent>
      </Dialog>
    </Stack>
  );
};
