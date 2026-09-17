import { useAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LidarExtractDialog } from '../lidarExtract/LidarExtractDialog';
import { Button, cx, Dialog } from '../ui';
import { NIB_MOSAIC_KEY } from './behold';
import type { FlyfotoProject } from './flyfotoProjects';
import { LocalityDetails } from './LocalityDetails';
import styles from './LocalityDialogs.module.css';
import { localityDetailsOpenAtom } from './toolAtoms';
import {
  FLYFOTO_BATCH_MAX,
  type LocalityWorkspaceApi,
} from './useLocalityWorkspace';

/**
 * The workspace's modals, mounted here rather than next to their triggers so
 * their lifetime is not tied to whichever row or popover is on screen. Detaljer
 * is driven by an atom because its trigger is inside a popover; the rest run
 * off controller state.
 */
export const LocalityDialogs = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useAtom(localityDetailsOpenAtom);
  // Which acquisitions are checked. `NIB_MOSAIC_KEY` stands for the seamless
  // mosaic, which is not a project and has no id of its own.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { flyfotoPicker, flyfotoProjects } = ws;

  // A closed dialog remembers nothing: reopening it is a new question.
  useEffect(() => {
    if (!flyfotoPicker) setPicked(new Set());
  }, [flyfotoPicker]);

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const atCap = picked.size >= FLYFOTO_BATCH_MAX;
  const check = (key: string) => ({
    type: 'checkbox' as const,
    checked: picked.has(key),
    // The cap is enforced on the way in rather than by truncating the run.
    disabled: atCap && !picked.has(key),
    onChange: () => toggle(key),
  });

  const selectNewest = () => {
    const next = new Set<string>();
    for (const p of (flyfotoProjects ?? []).slice(0, FLYFOTO_BATCH_MAX)) {
      next.add(p.id);
    }
    setPicked(next);
  };

  const startRun = () => {
    // The order the list is in: newest first, the mosaic ahead of it.
    const chosen: (FlyfotoProject | null)[] = picked.has(NIB_MOSAIC_KEY)
      ? [null]
      : [];
    for (const p of flyfotoProjects ?? []) {
      if (picked.has(p.id)) chosen.push(p);
    }
    ws.startFlyfotoPicker(chosen);
  };

  return (
    <>
      <LidarExtractDialog ws={ws} />

      {/* No footer, deliberately: every field commits to the draft on blur,
          and the only `Lagre` is on the row behind this dialog. A second one
          here would be a competing promise about when the change lands. */}
      <Dialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title={t('localities.workspace.details')}
        closeLabel={t('shared.close')}
      >
        <LocalityDetails
          locality={ws.locality}
          canEdit={ws.canEdit}
          onPatch={ws.patchLocality}
        />
      </Dialog>

      {/* `Lag min kopi`. The body says what comes along — the rectangle, the
          details, the funn and every image the app can make again — and what
          does not: the screenshots and the uploads. */}
      <Dialog
        open={ws.copyPrompt}
        onOpenChange={(next) => !next && ws.closeCopyPrompt()}
        title={t('localities.copy.title')}
        closeLabel={t('shared.close')}
        footer={
          <>
            <Button size="sm" palette="gray" onClick={ws.closeCopyPrompt}>
              {t('shared.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={ws.copyProgress != null}
              onClick={() => void ws.confirmCopy()}
            >
              {t('localities.copy.confirm')}
            </Button>
          </>
        }
      >
        <p className={styles.text}>{t('localities.copy.body')}</p>
      </Dialog>

      {/* Licensing notice before every flyfoto grab: NiB imagery is free for
          private use, publishing and commercial use are the user's own
          responsibility. Only the acquisition list waits behind it. */}
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
            <Button
              size="sm"
              variant="primary"
              onClick={ws.acceptFlyfotoNotice}
            >
              {t('localities.tools.flyfotoConfirm')}
            </Button>
          </>
        }
      >
        <p className={styles.text}>{t('localities.tools.flyfotoNotice')}</p>
      </Dialog>

      {/* The acquisition list: every ortofoto project NiB has flown over this
          area, back to the 1930s. Checking chooses what to be shown; only
          `Behold` on a card writes. */}
      <Dialog
        open={ws.flyfotoPicker}
        onOpenChange={(next) => !next && ws.closeFlyfotoPicker()}
        title={t('localities.tools.flyfotoPickerTitle')}
        closeLabel={t('shared.close')}
        footer={
          <>
            <Button size="sm" palette="gray" onClick={ws.closeFlyfotoPicker}>
              {t('shared.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={picked.size === 0}
              onClick={startRun}
            >
              {t('localities.tools.flyfotoRun', { count: picked.size })}
            </Button>
          </>
        }
      >
        <div className={styles.picker}>
          <label className={cx(styles.mosaic, styles.row)}>
            <input {...check(NIB_MOSAIC_KEY)} />
            <div className={styles.projectMain}>
              <span className={styles.title}>
                {t('localities.tools.flyfotoMosaic')}
              </span>
              <span className={styles.sub}>
                {t('localities.tools.flyfotoMosaicHint')}
              </span>
            </div>
          </label>

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
                <Button size="xs" variant="secondary" onClick={selectNewest}>
                  {t('localities.tools.flyfotoSelectNewest', {
                    count: Math.min(
                      ws.flyfotoProjects.length,
                      FLYFOTO_BATCH_MAX,
                    ),
                  })}
                </Button>
              </div>

              <p className={styles.hint}>
                {t('localities.tools.flyfotoCapHint', {
                  count: FLYFOTO_BATCH_MAX,
                })}
              </p>

              <div className={styles.projectList}>
                {ws.flyfotoProjects.map((project) => (
                  <label
                    key={project.id}
                    className={cx(styles.project, styles.row)}
                  >
                    <input {...check(project.id)} />
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
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
};
