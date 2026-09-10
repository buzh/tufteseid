import { useTranslation } from 'react-i18next';
import { LidarExtractPanel } from '../lidarExtract/LidarExtractPanel';
import { FunnDraft } from '../localities/FunnDraft';
import type { LocalityWorkspaceApi } from '../localities/useLocalityWorkspace';
import { cx, IconButton } from '../ui';
import styles from './Ribbon.module.css';
import toolStyles from './RibbonToolRow.module.css';

/**
 * Row 3 — the active lokalitet-scoped tool surface. Terrain is the third
 * member of `workspaceModeAtom` and is deliberately not here: it also runs
 * over a plain viewport rectangle, so `Ribbon` renders it directly.
 *
 * Rendered instead of the tray, not alongside it: the mutual exclusion is the
 * whole point. It also means the draft form and the extract panel are
 * unmounted whenever they are not the current task, so neither keeps a
 * half-finished sketch or a stale progress bar warm behind the tray.
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
      </div>
    </div>
  );
};
