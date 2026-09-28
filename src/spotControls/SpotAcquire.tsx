// Work ordered, not kept. The camera in the card keeps the view as it stands,
// so everything it offers is already on screen; these are the pictures that are
// asked for over the footprint instead — what the sidecar makes, and the
// flyfoto series, which is a walk through every acquisition over the spot
// rather than a reading of the one ground that happens to be up. Stands in
// front of the card, which is where the rows themselves are then waited on.
//
// The flyfoto walk takes the map, and then this box is a bar under it
// (`FlyfotoRun`) rather than a panel in the corner.

import { Alert } from '@mantine/core';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import type { EvidenceRecord } from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import { KIND_ICON, evidenceTitle } from '../evidence/labels';
import { mayRetry } from '../evidence/queue';
import {
  evidenceMatches,
  rendersOnServer,
  RVT_SPECS,
  SUN_LOOP_SPEC,
  type EvidenceSpec,
} from '../evidence/spec';
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

  const ordered = (evidence.items ?? []).filter((rec) =>
    rendersOnServer(rec.kind),
  );

  // A row with no pixels that nobody has settled is a render already on its
  // way. A settled one is left to the gallery's retry, which is where every
  // other kind's is.
  const onItsWay = (rec: EvidenceRecord) =>
    !rec.file && !mayRetry(evidence.stateOf(rec));

  // The sidecar takes one job per caller, whichever chip asked for it, so one
  // render closes every chip here — but only the chip whose picture it is may
  // say it is being made.
  const outstanding = ordered.some(onItsWay);

  const metric = spot.footprint ? bboxToMetric(spot.footprint) : null;
  const matching = (spec: EvidenceSpec) =>
    metric != null
      ? ordered.filter((rec) => evidenceMatches(rec, spec, metric))
      : [];
  const kept = (spec: EvidenceSpec) => matching(spec).length > 0;

  // Every chip here orders the same way and refuses for the same reasons; only
  // the wording and what is asked for differ. `note` is the line under the
  // label while nothing is happening, `about` the sentence in the tooltip —
  // the same string unless the idle line is better spent on a figure.
  const orderChip = (
    spec: EvidenceSpec,
    label: string,
    note: string,
    about = note,
  ) => {
    const title = `${label} — ${about}`;
    const state = () => {
      if (!spot.footprint) return t('acquire.noFootprint');
      if (matching(spec).some(onItsWay)) return t('evidence.rendering');
      if (outstanding) return t('acquire.busy');
      if (kept(spec)) return t('evidence.kept');
      return note;
    };
    return (
      <ControlChip
        key={label}
        icon={KIND_ICON[spec.kind]}
        label={label}
        hint={state()}
        withChevron={false}
        title={title}
        aria-label={title}
        disabled={!spot.footprint || outstanding || kept(spec)}
        onClick={() => evidence.keep(spec)}
      />
    );
  };

  // The list of what to propose is read off the rows as the run starts, so the
  // chip waits for them rather than offering a second copy of what is there.
  const flyfotoReady = spot.footprint != null && evidence.items != null;
  const flyfotoHint = () => {
    if (!spot.footprint) return t('acquire.noFootprint');
    if (!flyfotoReady) return t('evidence.loading');
    return t('acquire.flyfotoHint');
  };

  const flyfotoTitle = `${t('acquire.flyfoto')} — ${t('acquire.flyfotoHint')}`;

  // A run has the map, so the box becomes a bar along the bottom of it — the
  // same move the card's rectangle and pen make, for the same reason: what is
  // being judged is on the ground and the buttons follow the eye.
  if (run.phase !== 'off') {
    return <FlyfotoRun run={run} failed={evidence.failed} />;
  }

  return (
    <Panel
      className={styles.panel}
      icon="biotech"
      title={t('acquire.title')}
      // Back to the card: this box is one of its tools rather than a box of its
      // own, and the spot itself is closed from there.
      onClose={() => setAcquiring(false)}
    >
      <p className={styles.note}>{t('acquire.hint')}</p>
      <div className={styles.chips}>
        {orderChip(
          SUN_LOOP_SPEC,
          t('evidence.sunLoop'),
          t('evidence.facts.frames', { n: SUN_LOOP_FRAMES }),
          t('acquire.sunLoopHint'),
        )}
        {RVT_SPECS.map((spec) =>
          orderChip(spec, evidenceTitle(spec), t('acquire.rvtHint')),
        )}
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

      {evidence.failed && (
        <Alert color="red" mt="xs" p="xs">
          {t('evidence.failed')}
        </Alert>
      )}
    </Panel>
  );
};
