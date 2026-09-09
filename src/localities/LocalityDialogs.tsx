import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '../ui';
import styles from './LocalityDialogs.module.css';
import {
  FLYFOTO_BATCH_MAX,
  FLYFOTO_MOSAIC,
  type LocalityWorkspaceApi,
} from './useLocalityWorkspace';

/**
 * The workspace's three modals, kept out of the ribbon rows.
 *
 * None of them is anchored to a control, and all three are driven by
 * controller state rather than by whoever pressed the button — the flyfoto
 * notice hands off to the picker, and the grow prompt is raised from deep
 * inside the funn save path. Mounting them next to the trigger would tie
 * their lifetime to whichever row happens to be on screen.
 */
export const LocalityDialogs = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Grow-to-fit: the bbox is authored, so a funn that escapes it
          prompts rather than silently resizing. */}
      <Dialog
        open={ws.growPrompt != null}
        onOpenChange={(next) => !next && ws.cancelGrow()}
        title={t('localities.funn.heading')}
        closeLabel={t('shared.close')}
        footer={
          <>
            <Button size="sm" palette="gray" onClick={ws.cancelGrow}>
              {t('localities.funn.draft.cancel')}
            </Button>
            <Button size="sm" variant="primary" onClick={ws.confirmGrow}>
              {t('localities.funn.growConfirmAction')}
            </Button>
          </>
        }
      >
        <p className={styles.text}>{t('localities.funn.growConfirm')}</p>
      </Dialog>

      {/* Licensing notice shown before every flyfoto grab: NiB imagery is
          free for private use, but publishing or commercial use is the
          user's own responsibility. Confirm opens the picker. */}
      <Dialog
        open={ws.flyfotoNotice}
        onOpenChange={(next) => !next && ws.closeFlyfotoNotice()}
        title={t('localities.tools.flyfotoNoticeTitle')}
        closeLabel={t('shared.close')}
        footer={
          <>
            <Button size="sm" palette="gray" onClick={ws.closeFlyfotoNotice}>
              {t('localities.funn.draft.cancel')}
            </Button>
            <Button size="sm" variant="primary" onClick={ws.openFlyfotoPicker}>
              {t('localities.tools.flyfotoConfirm')}
            </Button>
          </>
        }
      >
        <p className={styles.text}>{t('localities.tools.flyfotoNotice')}</p>
      </Dialog>

      {/* Acquisition picker. NiB keeps every ortofoto project flown over an
          area back to the 1930s, so the same ground can be kept as a
          temporal stack rather than only as today's best mosaic. */}
      <Dialog
        open={ws.flyfotoPicker}
        onOpenChange={(next) => !next && ws.closeFlyfotoPicker()}
        title={t('localities.tools.flyfotoPickerTitle')}
        closeLabel={t('shared.close')}
        footer={
          <Button
            size="sm"
            palette="gray"
            disabled={ws.fetchingFlyfoto}
            onClick={ws.closeFlyfotoPicker}
          >
            {t('localities.tools.flyfotoClose')}
          </Button>
        }
      >
        <div className={styles.picker}>
          <div className={styles.mosaic}>
            <div className={styles.projectMain}>
              <span className={styles.title}>
                {t('localities.tools.flyfotoMosaic')}
              </span>
              <span className={styles.sub}>
                {t('localities.tools.flyfotoMosaicHint')}
              </span>
            </div>
            <Button
              size="xs"
              variant="primary"
              disabled={ws.fetchingFlyfoto}
              onClick={() => ws.runFlyfoto()}
            >
              {ws.flyfotoBusy === FLYFOTO_MOSAIC
                ? t('localities.tools.flyfotoFetching')
                : t('localities.tools.flyfotoGrab')}
            </Button>
          </div>

          {ws.flyfotoProjects === null && (
            <p className={styles.muted}>
              {t('localities.tools.flyfotoProjectsLoading')}
            </p>
          )}

          {ws.flyfotoProjectsError && (
            <p className={styles.error}>
              {t('localities.tools.flyfotoProjectsFailed')}
            </p>
          )}

          {ws.flyfotoProjects !== null &&
            !ws.flyfotoProjectsError &&
            ws.flyfotoProjects.length === 0 && (
              <p className={styles.muted}>
                {t('localities.tools.flyfotoProjectsNone')}
              </p>
            )}

          {ws.flyfotoProjects !== null && ws.flyfotoProjects.length > 0 && (
            <div className={styles.projects}>
              <div className={styles.projectsHead}>
                <span className={styles.title}>
                  {t('localities.tools.flyfotoProjectsHeading', {
                    count: ws.flyfotoProjects.length,
                  })}
                </span>
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={ws.fetchingFlyfoto}
                  onClick={ws.runFlyfotoAll}
                >
                  {t('localities.tools.flyfotoGrabAll', {
                    count: Math.min(
                      ws.flyfotoProjects.length,
                      FLYFOTO_BATCH_MAX,
                    ),
                  })}
                </Button>
              </div>

              {ws.flyfotoProjects.length > FLYFOTO_BATCH_MAX && (
                <p className={styles.hint}>
                  {t('localities.tools.flyfotoGrabAllHint', {
                    count: FLYFOTO_BATCH_MAX,
                  })}
                </p>
              )}

              <div className={styles.projectList}>
                {ws.flyfotoProjects.map((project) => (
                  <div key={project.id} className={styles.project}>
                    <div className={styles.projectMain}>
                      <span className={styles.title}>
                        {project.year ?? project.projectName}
                      </span>
                      <span className={styles.sub}>
                        {project.photoDate
                          ? `${project.photoDate} · ${project.projectName}`
                          : project.projectName}
                      </span>
                    </div>
                    <Button
                      size="xs"
                      palette="gray"
                      disabled={ws.fetchingFlyfoto}
                      onClick={() => ws.runFlyfoto(project)}
                    >
                      {ws.flyfotoBusy === project.id
                        ? t('localities.tools.flyfotoFetching')
                        : t('localities.tools.flyfotoGrab')}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
};
