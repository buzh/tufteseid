import { useTranslation } from 'react-i18next';
import { LidarExtractPanel } from '../lidarExtract/LidarExtractPanel';
import { FunnDraft } from '../localities/FunnDraft';
import type { LocalityWorkspaceApi } from '../localities/useLocalityWorkspace';
import { TerrainPanel } from '../terrain/TerrainPanel';
import { cx, IconButton } from '../ui';
import styles from './Ribbon.module.css';
import toolStyles from './RibbonToolRow.module.css';

/**
 * Row 3 — the active tool surface.
 *
 * Rendered instead of the tray, not alongside it: `workspaceModeAtom` is
 * `browse` or one of the three tools, and the mutual exclusion is the whole
 * point. It also means the draft form and the extract panel are unmounted
 * whenever they are not the current task, so neither keeps a half-finished
 * sketch or a stale progress bar warm behind the tray.
 */
export const RibbonToolRow = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();

  return (
    <div className={cx(styles.rowSub, toolStyles.root)}>
      <div className={toolStyles.inner}>
        {ws.mode === 'draft' && (
          <FunnDraft
            editing={ws.editingFunnId != null}
            title={ws.funnTitle}
            note={ws.funnNote}
            saving={ws.savingFunn}
            error={ws.funnError}
            onTitle={ws.setFunnTitle}
            onNote={ws.setFunnNote}
            onSave={ws.saveDraft}
            onCancel={ws.cancelDraft}
          />
        )}

        {ws.mode === 'lidar' && (
          <>
            <div className={toolStyles.head}>
              <h3 className={toolStyles.title}>
                {t('localities.tools.lidarExtract')}
              </h3>
              <IconButton
                icon="close"
                size="xs"
                palette="gray"
                aria-label={t('localities.tools.closeLidar')}
                onClick={ws.closeLidar}
              />
            </div>
            <LidarExtractPanel />
          </>
        )}

        {ws.mode === 'terrain' && (
          <>
            <div className={toolStyles.head}>
              <h3 className={toolStyles.title}>
                {t('localities.terrain.heading')}
              </h3>
              <IconButton
                icon="close"
                size="xs"
                palette="gray"
                aria-label={t('localities.terrain.close')}
                onClick={ws.toggleTerrain}
              />
            </div>
            <TerrainPanel />
          </>
        )}
      </div>
    </div>
  );
};
