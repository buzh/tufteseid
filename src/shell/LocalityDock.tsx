import { useAtom } from 'jotai';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LidarExtractPanel } from '../lidarExtract/LidarExtractPanel';
import { openSectionsAtom, type WorkspaceSectionId } from '../localities/atoms';
import { BilderSection } from '../localities/BilderSection';
import { FunnDraft } from '../localities/FunnDraft';
import { FunnList } from '../localities/FunnList';
import { KulturminnerSection } from '../localities/KulturminnerSection';
import { LocalityDetails } from '../localities/LocalityDetails';
import { dockOpenAtom } from '../localities/toolAtoms';
import type { LocalityWorkspaceApi } from '../localities/useLocalityWorkspace';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { TerrainPanel } from '../terrain/TerrainPanel';
import { CountBadge, IconButton, Section, Tooltip } from '../ui';
import { Dock, DockTool } from './Dock';
import styles from './LocalityDock.module.css';

/**
 * The open lokalitet, in the dock: whatever tool is running, then everything
 * the rectangle holds.
 *
 * The tool band and the section list coexist. Under the old tray they were
 * mutually exclusive — a tool row rendered *instead of* the columns — which
 * meant starting to draw hid the list of what you had already drawn, and
 * running an extract hid the gallery it was about to add to. Hiding the
 * content was never the invariant worth keeping.
 *
 * The bands read the two underlying flags rather than `workspaceModeAtom`,
 * which collapses them to one answer. Extract and terrain really are one
 * slot (`ribbonToolAtom` holds at most one). Drawing is not in that slot:
 * terrain is a read-only view of the same rectangle, and tracing what it
 * shows is the reason to have it up — so the draft band and the terrain band
 * can be on screen together, one above the other, which a column can do and
 * a ribbon row could not.
 *
 * Each section keeps its own error boundary. Bilder fetches short-lived file
 * tokens and Kulturminner hits an external WFS; either failing should cost
 * you that section, not the funn list above it.
 */
export const LocalityDock = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useAtom(dockOpenAtom);
  const [openSections, setOpenSections] = useAtom(openSectionsAtom);

  const sectionProps = (id: WorkspaceSectionId) => ({
    open: openSections.has(id),
    onOpenChange: (next: boolean) =>
      setOpenSections((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(id);
        else copy.delete(id);
        return copy;
      }),
  });

  // Starting a tool unfolds the dock: its controls are the tool. Row 1 owns
  // Terreng now, so pressing 5 with the dock folded away would otherwise
  // arm an analysis with nowhere to steer it from.
  const tool = ws.tool;
  const draftActive = ws.draftActive;
  useEffect(() => {
    if (tool || draftActive) setOpen(true);
  }, [tool, draftActive, setOpen]);

  // A grunnpakke is minutes long and started from a menu in the ribbon. Show
  // it landing, or the only feedback for the first stitch is a menu closing.
  const starterRunning = ws.starterStep != null;
  useEffect(() => {
    if (!starterRunning) return;
    setOpen(true);
    setOpenSections((prev) => new Set(prev).add('bilder'));
  }, [starterRunning, setOpen, setOpenSections]);

  return (
    <>
      {/* Folded away: a tab on the edge rather than nothing, so the content
          is still reachable — and still countable, which is the reason to
          unfold. The dock itself stays mounted behind it. */}
      {!open && (
        <div className={styles.tab}>
          <Tooltip label={t('localities.dock.show')}>
            <IconButton
              icon="right_panel_open"
              size="md"
              variant="secondary"
              aria-label={t('localities.dock.show')}
              onClick={() => setOpen(true)}
            />
          </Tooltip>
          <CountBadge count={ws.funnCount || null} palette="green" />
        </div>
      )}
      <Dock
        hidden={!open}
        head={
          <>
            <span className={styles.title} title={ws.locality.name}>
              {ws.locality.name}
            </span>
            <div className={styles.spacer} />
            <Tooltip label={t('localities.dock.hide')}>
              <IconButton
                icon="right_panel_close"
                size="sm"
                palette="gray"
                aria-label={t('localities.dock.hide')}
                onClick={() => setOpen(false)}
              />
            </Tooltip>
          </>
        }
      >
        {ws.draftActive && (
          <ErrorBoundary name="DockFunnDraft">
            <DockTool
              title={t(
                ws.draftIsEdit
                  ? 'localities.funn.draft.headingEdit'
                  : 'localities.funn.draft.heading',
              )}
              onClose={ws.stopDraft}
              closeLabel={t('localities.funn.draft.done')}
            >
              <FunnDraft
                editing={ws.draftIsEdit}
                saved={ws.draftFunnId != null}
                title={ws.funnTitle}
                note={ws.funnNote}
                saving={ws.savingFunn}
                error={ws.funnError}
                outside={ws.funnOutside}
                onTitle={ws.setFunnTitle}
                onNote={ws.setFunnNote}
                onCommit={ws.commitDraftMeta}
                onGrow={ws.growToFitDrawing}
                onDone={ws.stopDraft}
              />
            </DockTool>
          </ErrorBoundary>
        )}

        {ws.tool === 'lidar' && (
          <ErrorBoundary name="DockLidarExtract">
            <DockTool
              title={t('localities.tools.lidarExtract')}
              onClose={ws.closeLidar}
              closeLabel={t('localities.tools.closeLidar')}
            >
              <LidarExtractPanel />
            </DockTool>
          </ErrorBoundary>
        )}

        {ws.tool === 'terrain' && (
          <ErrorBoundary name="DockTerrain">
            <DockTool
              title={t('localities.terrain.heading')}
              onClose={ws.toggleTerrain}
              closeLabel={t('localities.terrain.close')}
            >
              <TerrainPanel bbox={ws.locality.bbox} locality={ws.locality} />
            </DockTool>
          </ErrorBoundary>
        )}

        <ErrorBoundary name="DockFunn">
          <Section
            title={t('localities.funn.heading')}
            count={ws.funnCount}
            countPalette="green"
            scroll
            {...sectionProps('funn')}
          >
            <FunnList
              items={ws.findItems}
              editable={ws.isMine}
              selectedId={ws.selectedFunnId}
              onSelect={ws.selectFunn}
              onStatus={ws.changeStatus}
              onSaveMeta={ws.saveFunnMeta}
              onEditGeometry={ws.startGeometryEdit}
              onDelete={ws.removeFunn}
            />
          </Section>
        </ErrorBoundary>

        <ErrorBoundary name="DockBilder">
          <Section
            title={t('localities.bilder.heading')}
            count={ws.bilderCount}
            scroll
            {...sectionProps('bilder')}
          >
            <BilderSection
              isMine={ws.isMine}
              items={ws.attachmentItems}
              setItems={ws.setAttachmentItems}
              uploading={ws.uploading}
              onUpload={ws.uploadFile}
              starterStep={ws.starterStep}
            />
          </Section>
        </ErrorBoundary>

        <ErrorBoundary name="DockKulturminner">
          <Section
            title={t('localities.kulturminner.heading')}
            count={ws.kmCount}
            countPalette="yellow"
            scroll
            {...sectionProps('kulturminner')}
          >
            <KulturminnerSection
              result={ws.kulturminner.result}
              error={ws.kulturminner.error}
            />
          </Section>
        </ErrorBoundary>

        {/* Last, because it is the one section you set once and stop looking
            at. */}
        <ErrorBoundary name="DockDetaljer">
          <Section
            title={t('localities.workspace.details')}
            {...sectionProps('detaljer')}
          >
            <LocalityDetails
              locality={ws.locality}
              isMine={ws.isMine}
              onPatch={ws.patchLocality}
            />
          </Section>
        </ErrorBoundary>
      </Dock>
    </>
  );
};
