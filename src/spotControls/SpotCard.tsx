import { ActionIcon, Alert, Button, Switch, Tooltip } from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { updateSpot, type SpotRecord } from '../api/spots';
import { useHasFeature } from '../auth/features';
import { EvidenceGallery } from '../evidence/EvidenceGallery';
import { exportLabel } from '../evidence/labels';
import { isReadable } from '../evidence/spec';
import {
  useSpotEvidence,
  type SpotEvidence,
} from '../evidence/useSpotEvidence';
import { useSpotExport } from '../export/useSpotExport';
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

type RendersFold = { open: boolean; toggle: () => void };

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
  const drawing = hold?.stage === 'sketch';

  const offer = hold ? null : evidence.offer;
  const keepLabel = t(offer?.kept ? 'evidence.kept' : 'evidence.keep');

  const hasSketch = hold ? hold.hasSketch : sketchOf(spot.sketch) !== null;

  const bundle = useSpotExport(spot, evidence.items);

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
          <Button size="compact-xs" variant="default" onClick={hold.abort}>
            {t('spots.abort')}
          </Button>
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
              disabled={hold != null || !spot.footprint}
              onClick={() => spot.footprint && readTerrain(spot.footprint)}
            />
          </Tooltip>
          {serviceOn('flyfoto') && (
            <Tooltip label={flyfotoHint}>
              <ControlButton
                icon="flight"
                aria-label={t('acquire.flyfoto')}
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
                disabled={hold != null}
                onClick={renders.toggle}
              />
            </Tooltip>
          )}
          <Tooltip
            label={exportLabel({ running: bundle.busy, failed: bundle.failed })}
          >
            <ControlButton
              icon={bundle.busy ? 'hourglass_top' : 'folder_zip'}
              aria-label={t('export.label')}
              disabled={bundle.busy || hold != null || !evidence.items}
              onClick={bundle.run}
            />
          </Tooltip>
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

  if (run.phase !== 'off') {
    return <FlyfotoRun run={run} failed={evidence.failed} />;
  }

  return (
    <Panel
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
