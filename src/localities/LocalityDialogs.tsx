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
 * The workspace's modals, kept out of the ribbon rows.
 *
 * None of them is anchored to a control, and all are driven by controller
 * state rather than by whoever pressed the button — the flyfoto notice hands
 * off to the acquisition list. Mounting them next to the trigger would tie
 * their lifetime to whichever row happens to be on screen.
 *
 * Two of them are the selection dialogs behind `Hent ▾` (§4.3). Both survived
 * the picker unchanged in what they *ask*; what changed is what happens after:
 * they hand a list of proposals to a picker run instead of saving anything.
 *
 * Detaljer is the newest and the odd one out — it *is* anchored to a control,
 * the `⋮` menu on the lokalitet row, and it is driven by an atom rather than
 * by the controller for exactly that reason. It is here anyway because a
 * dialog raised from inside a popover would die with the popover.
 *
 * Grow-to-fit used to be one of these, raised from inside the funn save path.
 * It is an inline warning on the draft row now: drawing past the edge of the
 * rectangle is worth remarking on, but not worth stopping the pen for.
 */
export const LocalityDialogs = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useAtom(localityDetailsOpenAtom);
  // Which acquisitions are checked. `NIB_MOSAIC_KEY` stands for the seamless
  // one, which is not a project and has no id of its own.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { flyfotoPicker, flyfotoProjects } = ws;

  // A closed dialog remembers nothing: reopening it is a new question, and a
  // list still checked from last time is how you grab eight photographs you
  // meant to grab once.
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
    // The cap is enforced on the way in rather than by silently truncating
    // the run: a checkbox you ticked that turns out not to count is worse
    // than one you could not tick.
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
    // The order the list is in — newest first, the mosaic ahead of it. The
    // rail should walk the way the author read it.
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

      {/* Beskrivelse, sted, kommune, matrikkel, synlighet — the lokalitet's
          own fields, which used to be the section at the bottom of the dock
          (§6). A dialog because it is the one part of a lokalitet you fill in
          once and then stop looking at, and because the fields are a form:
          they need width and a body, and neither fits on a ribbon row.

          No footer. Every field in it writes on blur, the same as it did in
          the dock, so a `Lagre` here would be a second, competing promise
          about when the change lands. */}
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

      {/* Licensing notice shown before every flyfoto grab: NiB imagery is
          free for private use, but publishing or commercial use is the
          user's own responsibility. Only the acquisition list waits behind
          it — the starter set no longer fetches ortofoto, so nobody is asked
          to accept NiB's terms who has not asked for a photograph. */}
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

      {/* The acquisition list. NiB keeps every ortofoto project flown over an
          area back to the 1930s, so the same ground can be read as a temporal
          stack rather than only as today's best mosaic — which is exactly the
          "give me several of these at once so I can compare" question the
          picker exists to answer. Checking is choosing what to be shown; only
          `Behold` on a card writes anything. */}
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
