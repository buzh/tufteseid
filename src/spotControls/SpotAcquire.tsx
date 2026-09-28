// Work ordered, not kept. The camera in the card keeps the view as it stands,
// so everything it offers is already on screen; these are the pictures that are
// asked for over the footprint instead — a sun loop the sidecar makes, and the
// flyfoto series, which is a walk through every acquisition over the spot
// rather than a reading of the one ground that happens to be up. Stands in
// front of the card, which is where the rows themselves are then waited on.

import { Alert } from '@mantine/core';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import type { SpotRecord } from '../api/spots';
import { mayRetry } from '../evidence/queue';
import { evidenceMatches, SUN_LOOP_SPEC } from '../evidence/spec';
import { useSpotEvidence } from '../evidence/useSpotEvidence';
import { bboxToMetric } from '../map/bbox';
import { spotAcquiringAtom } from '../spots/atoms';
import { ControlChip } from '../ui/ControlChip';
import { Panel } from '../ui/Panel';
import { FlyfotoRun } from './FlyfotoRun';
import styles from './SpotBox.module.css';
import { useFlyfotoRun } from './useFlyfotoRun';

const SUN_LOOP_FRAMES = Math.round(360 / SUN_LOOP_SPEC.stepDeg);

export const SpotAcquire = ({ spot }: { spot: SpotRecord }) => {
  const { t } = useTranslation();
  const setAcquiring = useSetAtom(spotAcquiringAtom);
  const evidence = useSpotEvidence(spot);
  const run = useFlyfotoRun(spot.footprint, evidence);

  const loops = (evidence.items ?? []).filter((rec) => rec.kind === 'sunloop');

  // A row with no pixels that nobody has settled is a loop already on its way,
  // and the sidecar takes one job per caller. A settled one is left to the
  // gallery's retry, which is where every other kind's is.
  const outstanding = loops.some(
    (rec) => !rec.file && !mayRetry(evidence.stateOf(rec)),
  );

  const metric = spot.footprint ? bboxToMetric(spot.footprint) : null;
  const kept =
    metric != null &&
    loops.some((rec) => evidenceMatches(rec, SUN_LOOP_SPEC, metric));

  const sunHint = () => {
    if (!spot.footprint) return t('acquire.noFootprint');
    if (outstanding) return t('evidence.rendering');
    if (kept) return t('evidence.kept');
    return t('evidence.facts.frames', { n: SUN_LOOP_FRAMES });
  };

  // The list of what to propose is read off the rows as the run starts, so the
  // chip waits for them rather than offering a second copy of what is there.
  const flyfotoReady = spot.footprint != null && evidence.items != null;
  const flyfotoHint = () => {
    if (!spot.footprint) return t('acquire.noFootprint');
    if (!flyfotoReady) return t('evidence.loading');
    return t('acquire.flyfotoHint');
  };

  const sunTitle = `${t('evidence.sunLoop')} — ${t('acquire.sunLoopHint')}`;
  const flyfotoTitle = `${t('acquire.flyfoto')} — ${t('acquire.flyfotoHint')}`;

  return (
    <Panel
      className={styles.panel}
      icon="biotech"
      title={t('acquire.title')}
      // Back to the card: this box is one of its tools rather than a box of its
      // own, and the spot itself is closed from there.
      onClose={() => setAcquiring(false)}
    >
      {run.phase === 'off' ? (
        <>
          <p className={styles.note}>{t('acquire.hint')}</p>
          <div className={styles.chips}>
            <ControlChip
              icon="motion_photos_on"
              label={t('evidence.sunLoop')}
              hint={sunHint()}
              withChevron={false}
              title={sunTitle}
              aria-label={sunTitle}
              disabled={!spot.footprint || outstanding || kept}
              onClick={() => evidence.keep(SUN_LOOP_SPEC)}
            />
            <ControlChip
              icon="photo_camera"
              label={t('acquire.flyfoto')}
              hint={flyfotoHint()}
              withChevron={false}
              title={flyfotoTitle}
              aria-label={flyfotoTitle}
              disabled={!flyfotoReady}
              onClick={run.start}
            />
          </div>
        </>
      ) : (
        <FlyfotoRun run={run} />
      )}

      {evidence.failed && (
        <Alert color="red" mt="xs" p="xs">
          {t('evidence.failed')}
        </Alert>
      )}
    </Panel>
  );
};
