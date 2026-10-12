// Only ever the author's own, or an admin's: `spotReadingAtom` sends anybody
// else straight to `EvidenceReader` and keeps them there, so nothing in here —
// nor in `EvidenceGallery`, which only this box mounts — is behind `mayEdit`.

import { ActionIcon, Alert, Button, Switch, Tooltip } from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { updateSpot, type SpotRecord } from '../api/spots';
import { useHasFeature } from '../auth/features';
import { EvidenceGallery } from '../evidence/EvidenceGallery';
import { isReadable } from '../evidence/spec';
import {
  useSpotEvidence,
  type SpotEvidence,
} from '../evidence/useSpotEvidence';
import { serviceOn } from '../services';
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
import { StarControl } from '../spots/StarControl';
import { VoteControl } from '../spots/VoteControl';
import { readTerrainWindowAtom } from '../terrain/window';
import { ControlButton } from '../ui/ControlButton';
import { cx } from '../ui/cx';
import { Hint } from '../ui/Hint';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { FlyfotoRun } from './FlyfotoRun';
import styles from './SpotBox.module.css';
import { SpotRenders } from './SpotRenders';
import { useFlyfotoRun, type FlyfotoRun as Run } from './useFlyfotoRun';
import { useSpotDraft, type SpotDraftController } from './useSpotDraft';

/** Open or closed, and the press that changes it: the renders list is the
 *  card's, because the box is wider while it stands. */
type RendersFold = { open: boolean; toggle: () => void };

/** `hold` is present exactly while a draft has the map, and is then the only
 *  current account of the rectangle and the drawing — the record lags it by a
 *  round trip. */
const SpotUnits = ({
  spot,
  evidence,
  run,
  renders,
  hold,
}: {
  spot: SpotRecord;
  evidence: SpotEvidence;
  run: Run;
  renders: RendersFold;
  hold?: SpotDraftController;
}) => {
  const { t } = useTranslation();
  const adjust = useSetAtom(adjustSpotDraftAtom);
  const readTerrain = useSetAtom(readTerrainWindowAtom);
  const mayRender = useHasFeature('render');
  const framing = hold?.stage === 'footprint';
  // The card is away behind the canvas for the whole of a draw stage, so this
  // only keeps the fade from re-rendering on every settle of a pen nobody can
  // see it from.
  const drawing = hold?.stage === 'sketch';

  // A stage has the map: the rectangle being dragged is not the one the record
  // carries and a draw session has the map frozen, so a picture kept now would
  // not be of what the offer says.
  const offer = hold ? null : evidence.offer;
  const keepLabel = t(offer?.kept ? 'evidence.kept' : 'evidence.keep');

  const hasSketch = hold ? hold.hasSketch : sketchOf(spot.sketch) !== null;

  const flyfotoHint = !spot.footprint
    ? t('acquire.noFootprint')
    : !evidence.items
      ? t('evidence.loading')
      : `${t('acquire.flyfoto')} — ${t('acquire.flyfotoHint')}`;

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
      ) : (
        <div className={styles.tools}>
          <Hint
            id="keepPicture"
            tips={offer && !offer.kept ? [t('hints.keepPicture')] : []}
          >
            <Tooltip label={keepLabel}>
              <ControlButton
                icon={offer?.kept ? 'check' : 'photo_camera'}
                aria-label={keepLabel}
                disabled={!offer || offer.kept}
                onClick={() => offer && evidence.keep(offer.spec)}
              />
            </Tooltip>
          </Hint>
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
          <Tooltip label={t('terrainControls.readFootprint')}>
            <ControlButton
              icon="elevation"
              aria-label={t('terrainControls.readFootprint')}
              // Nothing to read over, and the card's repair write is on its way
              // to giving the spot one.
              disabled={hold != null || !spot.footprint}
              onClick={() => spot.footprint && readTerrain(spot.footprint)}
            />
          </Tooltip>
          {serviceOn('flyfoto') && (
            <Tooltip label={flyfotoHint}>
              <ControlButton
                icon="flight"
                aria-label={t('acquire.flyfoto')}
                // The walk takes the map, and the list of what to propose is
                // read off the rows as it starts.
                disabled={hold != null || !spot.footprint || !evidence.items}
                onClick={run.start}
              />
            </Tooltip>
          )}
          {mayRender && (
            <Tooltip label={t('renders.hint')}>
              <ControlButton
                icon="function"
                on={renders.open}
                aria-label={t('renders.title')}
                aria-expanded={renders.open}
                // The sidecar renders over the footprint, which a draft is in
                // the middle of moving.
                disabled={hold != null}
                onClick={renders.toggle}
              />
            </Tooltip>
          )}
        </div>
      )}

      {renders.open && !hold && mayRender && (
        <SpotRenders spot={spot} evidence={evidence} />
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

/** Mounted only while a card draft lives, so the controller opens and — more
 *  to the point — flushes with it, while the card around it stands. */
const SpotUnitsHeld = ({
  draft,
  ...rest
}: {
  spot: SpotRecord;
  evidence: SpotEvidence;
  run: Run;
  renders: RendersFold;
  draft: SpotDraft;
}) => {
  const hold = useSpotDraft(draft, rest.spot);
  return <SpotUnits {...rest} hold={hold} />;
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
  const run = useFlyfotoRun(spot.footprint, evidence);

  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [rendersOpen, setRendersOpen] = useState(false);
  const renders = useMemo(
    () => ({
      open: rendersOpen,
      toggle: () => setRendersOpen((open) => !open),
    }),
    [rendersOpen],
  );

  // Rows saved before the rule that a spot always has a rectangle. Repaired
  // here rather than by a migration: deriving the square from the drawing
  // wants a projection PocketBase's JSVM has not got. Not while a draft is in
  // hand, whose own writes are serialized and this one is not.
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

  // A run has the map, so the card becomes a bar along the bottom of it.
  if (run.phase !== 'off') {
    return <FlyfotoRun run={run} failed={evidence.failed} />;
  }

  return (
    <Panel
      // The list stands down while a draft has the map, and the box narrows
      // with it rather than holding the width of something not on screen.
      className={cx(styles.panel, rendersOpen && !draft && styles.panelWide)}
      icon="location_on"
      title={spot.name}
      onClose={() => setActive(null)}
      actions={
        <>
          <VoteControl spot={spot} />
          <StarControl spot={spot} />
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
        </>
      }
      footer={
        <>
          {readable > 0 && (
            <Button
              size="xs"
              variant="default"
              // A reading is suspended for as long as any draft lives, so with
              // the map in hand this would do nothing until it was let go.
              disabled={draft != null}
              leftSection={<Icon icon="menu_book" size={16} />}
              onClick={() => setReading(true)}
            >
              {t('evidence.read')}
            </Button>
          )}
        </>
      }
    >
      {draft ? (
        <SpotUnitsHeld
          key={draft.id}
          spot={spot}
          evidence={evidence}
          run={run}
          renders={renders}
          draft={draft}
        />
      ) : (
        <SpotUnits
          spot={spot}
          evidence={evidence}
          run={run}
          renders={renders}
        />
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

      <EvidenceGallery spot={spot} evidence={evidence} />

      {failed && (
        <Alert color="red" mt="xs" p="xs">
          {t('spots.visibilityFailed')}
        </Alert>
      )}
    </Panel>
  );
};
