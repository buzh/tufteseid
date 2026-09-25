// The spot's own workbench. Reading terrain against a place is the ongoing act
// and naming it a one-off, so this box — not the editor — is where the reader
// spends their time: what the spot is in two terse lines, the rectangle and the
// drawing to reach for, and the pictures. `SpotProperties` is behind the
// cogwheel.
//
// Only ever the author's own, or an admin's: `spotReadingAtom` sends anybody
// else straight to `EvidenceReader` and keeps them there, so nothing in here —
// nor in `EvidenceGallery`, which only this box mounts — is behind `mayEdit`.

import { ActionIcon, Alert, Button, Switch, Tooltip } from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { updateSpot, type SpotRecord } from '../api/spots';
import { EvidenceGallery } from '../evidence/EvidenceGallery';
import { isReadable } from '../evidence/labels';
import { useSpotEvidence } from '../evidence/useSpotEvidence';
import { sketchOf } from '../sketch/scene';
import { SketchFade } from '../sketch/SketchFade';
import {
  activeSpotAtom,
  adjustSpotDraftAtom,
  editSpotDraftAtom,
  spotDraftAtom,
  spotReadingAtom,
  type SpotDraft,
} from '../spots/atoms';
import { derivedFootprint } from '../spots/footprint';
import { ControlButton } from '../ui/ControlButton';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import styles from './SpotBox.module.css';
import { useSpotDraft, type SpotDraftController } from './useSpotDraft';

/**
 * The rectangle and the drawing: the two things adjusted against the ground
 * rather than filled into a form, so the card does them itself. `hold` is
 * present exactly while a draft has the map, and is then the only current
 * account of either — the record lags it by a round trip.
 */
const SpotUnits = ({
  spot,
  hold,
}: {
  spot: SpotRecord;
  hold?: SpotDraftController;
}) => {
  const { t } = useTranslation();
  const adjust = useSetAtom(adjustSpotDraftAtom);
  const framing = hold?.stage === 'footprint';
  const drawing = hold?.stage === 'sketch';

  const hasSketch = hold ? hold.hasSketch : sketchOf(spot.sketch) !== null;

  return (
    <>
      {framing && hold ? (
        <div className={cx(styles.unit, styles.unitStep)}>
          <Icon icon="crop_free" size={14} />
          <span className={styles.unitText}>{t('spots.footprintHint')}</span>
          <Button size="compact-xs" onClick={hold.finish}>
            {t('spots.done')}
          </Button>
        </div>
      ) : drawing && hold ? (
        <div className={cx(styles.unit, styles.unitStep)}>
          <Icon icon="draw" size={14} />
          <span className={styles.unitText}>{t('spots.sketchLabel')}</span>
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={hold.abort}
          >
            {t('spots.abort')}
          </Button>
          <Button size="compact-xs" onClick={hold.finish}>
            {t('spots.save')}
          </Button>
        </div>
      ) : (
        <div className={styles.tools}>
          <Tooltip label={t('spots.footprintChange')}>
            <ControlButton
              icon="crop_free"
              aria-label={t('spots.footprintChange')}
              onClick={() => adjust(spot, 'footprint')}
            />
          </Tooltip>
          <Tooltip
            label={hasSketch ? t('spots.sketchChange') : t('spots.sketchAdd')}
          >
            <ControlButton
              icon="draw"
              aria-label={
                hasSketch ? t('spots.sketchChange') : t('spots.sketchAdd')
              }
              onClick={() => adjust(spot, 'sketch')}
            />
          </Tooltip>
        </div>
      )}

      {hasSketch && !drawing && <SketchFade className={styles.sketchFade} />}

      {hold?.sketchTooBig && (
        <Alert color="red" mt="xs" p="xs">
          {t('spots.sketchTooBig')}
        </Alert>
      )}
    </>
  );
};

/** Mounted only while a card draft lives, so the draft controller opens and —
 *  more to the point — flushes with it, while the card around it stands. */
const SpotUnitsHeld = ({
  spot,
  draft,
}: {
  spot: SpotRecord;
  draft: SpotDraft;
}) => {
  const hold = useSpotDraft(draft, spot);
  return <SpotUnits spot={spot} hold={hold} />;
};

export const SpotCard = ({ spot }: { spot: SpotRecord }) => {
  const { t } = useTranslation();
  const setActive = useSetAtom(activeSpotAtom);
  const edit = useSetAtom(editSpotDraftAtom);
  const setReading = useSetAtom(spotReadingAtom);
  // Only ever a card draft: an editor draft puts `SpotProperties` here instead.
  const draft = useAtomValue(spotDraftAtom);

  const evidence = useSpotEvidence(spot);
  const readable = (evidence.items ?? []).filter(isReadable).length;

  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Rows saved before the rule that a spot always has a rectangle. Repaired
  // here rather than by a migration: deriving the square from the drawing wants
  // a projection PocketBase's JSVM has not got. Not while a draft is in hand,
  // whose own writes are serialized and this one is not.
  const repairing = useRef(false);
  useEffect(() => {
    if (draft || spot.footprint || repairing.current) return;
    repairing.current = true;
    updateSpot(spot.id, {
      footprint: derivedFootprint(spot.point, spot.sketch).bbox,
    })
      .then(setActive)
      .catch((err) => console.warn('[spots] footprint repair failed', err));
  }, [draft, spot, setActive]);

  const setVisibility = (makePublic: boolean) => {
    setBusy(true);
    setFailed(false);
    updateSpot(spot.id, { visibility: makePublic ? 'public' : 'private' })
      .then(setActive)
      .catch((err) => {
        console.warn('[spots] visibility failed', err);
        setFailed(true);
      })
      .finally(() => setBusy(false));
  };

  return (
    <Panel
      className={styles.panel}
      icon="location_on"
      title={spot.name}
      onClose={() => setActive(null)}
      actions={
        <Tooltip label={t('spots.edit')}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            disabled={draft != null}
            aria-label={t('spots.edit')}
            onClick={() => edit(spot)}
          >
            <Icon icon="settings" size={18} />
          </ActionIcon>
        </Tooltip>
      }
      footer={
        readable > 0 && (
          <Button
            size="xs"
            variant="default"
            // A reading is suspended for as long as any draft lives, so opening
            // one with the map in hand would do nothing until it was let go.
            disabled={draft != null}
            leftSection={<Icon icon="menu_book" size={16} />}
            onClick={() => setReading(true)}
          >
            {t('evidence.read')}
          </Button>
        )
      }
    >
      {draft ? (
        <SpotUnitsHeld key={draft.id} spot={spot} draft={draft} />
      ) : (
        <SpotUnits spot={spot} />
      )}

      {spot.description && <p className={styles.prose}>{spot.description}</p>}

      <Switch
        mt="xs"
        size="xs"
        disabled={busy}
        checked={spot.visibility === 'public'}
        label={t('spots.public')}
        description={t('spots.publicHint')}
        onChange={(event) => setVisibility(event.currentTarget.checked)}
      />

      <EvidenceGallery spot={spot} evidence={evidence} held={draft != null} />

      {failed && (
        <Alert color="red" mt="xs" p="xs">
          {t('spots.visibilityFailed')}
        </Alert>
      )}
    </Panel>
  );
};
