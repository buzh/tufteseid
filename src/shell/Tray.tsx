import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { openSectionsAtom, type WorkspaceSectionId } from '../localities/atoms';
import { BilderSection } from '../localities/BilderSection';
import { FunnList } from '../localities/FunnList';
import { KulturminnerSection } from '../localities/KulturminnerSection';
import { LocalityDetails } from '../localities/LocalityDetails';
import { trayOpenAtom } from '../localities/toolAtoms';
import type { LocalityWorkspaceApi } from '../localities/useLocalityWorkspace';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { cx, Icon, Section } from '../ui';
import styles from './Ribbon.module.css';
import trayStyles from './Tray.module.css';

/**
 * The tray — what is *in* the open lokalitet, shown while no tool has taken
 * the surface over.
 *
 * Each column gets its own error boundary. The Bilder gallery fetches
 * short-lived file tokens and the Kulturminner column hits an external WFS;
 * either failing should cost you that column, not the funn list next to it.
 */
export const Tray = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useAtom(trayOpenAtom);
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

  return (
    <div className={cx(styles.rowSub, trayStyles.root)}>
      {open && (
        <div className={trayStyles.columns}>
          <div className={trayStyles.column}>
            <ErrorBoundary name="TrayFunn">
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
          </div>

          <div className={trayStyles.column}>
            <ErrorBoundary name="TrayBilder">
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
                />
              </Section>
            </ErrorBoundary>
          </div>

          <div className={trayStyles.column}>
            <ErrorBoundary name="TrayKulturminner">
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

            {/* Under Kulturminner rather than in a fourth column: it is the
                one section you set once and stop looking at. */}
            <ErrorBoundary name="TrayDetaljer">
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
          </div>
        </div>
      )}

      <button
        type="button"
        className={trayStyles.toggle}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon
          icon="keyboard_arrow_down"
          size={18}
          className={cx(trayStyles.chevron, open && trayStyles.chevronOpen)}
        />
        {open ? t('ribbon.tray.hide') : t('ribbon.tray.show')}
      </button>
    </div>
  );
};
