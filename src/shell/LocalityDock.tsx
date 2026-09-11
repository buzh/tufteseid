import { useAtom } from 'jotai';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { openSectionsAtom, type WorkspaceSectionId } from '../localities/atoms';
import { FunnDraft } from '../localities/FunnDraft';
import { FunnList } from '../localities/FunnList';
import { KulturminnerSection } from '../localities/KulturminnerSection';
import { LocalityDetails } from '../localities/LocalityDetails';
import { dockOpenAtom } from '../localities/toolAtoms';
import type { LocalityWorkspaceApi } from '../localities/useLocalityWorkspace';
import { ErrorBoundary } from '../shared/ErrorBoundary';
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
 * which collapses them to one answer. Only the extract has a band here now:
 * terrain shares its slot (`ribbonToolAtom` holds at most one) but is steered
 * from the ribbon, since it is one of the five grounds. Drawing is not in
 * that slot at all — terrain is a read-only view of the same rectangle, and
 * tracing what it shows is the reason to have it up, so a draft and a terrain
 * render are deliberately live at the same time.
 *
 * Each section keeps its own error boundary. Kulturminner hits an external
 * WFS; it failing should cost you that section, not the funn list above it.
 *
 * Bilder is no longer one of them — it left for the bottom edge (§4.3). What
 * is left here is on its way out too: step 12 turns Funn and Kulturminner
 * into popovers on the row and Detaljer into a dialog, and this file goes
 * with the column.
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

  // Starting a funn draft unfolds the dock: its controls are the tool.
  // Neither Terreng nor LiDAR-uttrekk is in that list — the first is steered
  // from the ribbon and the second is a dialog now, so throwing the dock open
  // for either would cover the map with a column the user has no business in.
  const draftActive = ws.draftActive;
  useEffect(() => {
    if (draftActive) setOpen(true);
  }, [draftActive, setOpen]);

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

        {/* No terrain band. Terrenganalyse is a ground like the other four
            now: its knobs are on the ribbon's settings strip and its slider
            row, over the terrain they describe, and the way out is picking
            another ground from the ring. */}

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
              editable={ws.canEdit}
              selectedId={ws.selectedFunnId}
              onSelect={ws.selectFunn}
              onStatus={ws.changeStatus}
              onSaveMeta={ws.saveFunnMeta}
              onEditGeometry={ws.startGeometryEdit}
              onDelete={ws.removeFunn}
            />
          </Section>
        </ErrorBoundary>

        {/* No Bilder section. The images are the bottom edge now — a rail
            along the map rather than a grid down a column (§4.3, and
            src/localities/BilderStrip.tsx). */}

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
              canEdit={ws.canEdit}
              onPatch={ws.patchLocality}
            />
          </Section>
        </ErrorBoundary>
      </Dock>
    </>
  );
};
