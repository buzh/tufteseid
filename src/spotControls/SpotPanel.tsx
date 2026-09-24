import {
  Alert,
  Button,
  Group,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';

import {
  SPOT_DESCRIPTION_MAX,
  SPOT_NAME_MAX,
  type SpotRecord,
} from '../api/spots';
import { EvidenceStrip } from '../evidence/EvidenceStrip';
import { cx } from '../ui/cx';
import { ControlButton } from '../ui/ControlButton';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { formatPoint } from '../spots/geo';
import styles from './SpotBox.module.css';
import type { SpotDraftController } from './useSpotDraft';

export const SpotPanel = ({
  spot,
  record,
}: {
  spot: SpotDraftController;
  /** The saved spot the draft is editing, or null for one being made: what the
   *  pictures hang off. */
  record: SpotRecord | null;
}) => {
  const { t } = useTranslation();
  const placing = spot.stage === 'pin';
  const framing = spot.stage === 'footprint';
  const drawing = spot.stage === 'sketch';

  return (
    <Panel
      className={styles.panel}
      icon="add_location"
      title={spot.draft.recordId ? t('spots.editTitle') : t('spots.newTitle')}
      onClose={spot.abort}
      unsaved={spot.dirty}
      footer={
        <Button
          size="xs"
          loading={spot.saving}
          disabled={!spot.canSave}
          onClick={spot.save}
        >
          {t('spots.save')}
        </Button>
      }
    >
      <TextInput
        size="xs"
        maxLength={SPOT_NAME_MAX}
        label={t('spots.name')}
        placeholder={
          spot.suggesting
            ? t('spots.namePlaceholderBusy')
            : t('spots.namePlaceholder')
        }
        value={spot.name}
        onChange={(event) => spot.setName(event.currentTarget.value)}
      />

      <Textarea
        size="xs"
        mt="xs"
        maxLength={SPOT_DESCRIPTION_MAX}
        label={t('spots.description')}
        placeholder={t('spots.descriptionPlaceholder')}
        autosize
        minRows={3}
        maxRows={8}
        value={spot.description}
        onChange={(event) => spot.setDescription(event.currentTarget.value)}
      />

      <div className={cx(styles.coords, placing && styles.coordsLive)}>
        <Icon icon="my_location" size={14} />
        <span className={styles.coordsText}>
          {formatPoint(spot.draft.point)}
        </span>
        <Button
          size="compact-xs"
          variant={placing ? 'filled' : 'default'}
          onClick={() => spot.setStage(placing ? 'sketch' : 'pin')}
        >
          {placing ? t('spots.pinDone') : t('spots.pinChange')}
        </Button>
      </div>

      <Group gap="xs" mt="xs" justify="space-between">
        <Tooltip
          label={framing ? t('spots.footprintStop') : t('spots.footprintStart')}
        >
          <ControlButton
            icon="crop_free"
            on={framing}
            aria-label={t('spots.footprint')}
            aria-pressed={framing}
            onClick={() => spot.setStage(framing ? 'pin' : 'footprint')}
          />
        </Tooltip>
        <span className={styles.coordsText}>
          {spot.footprintSide == null
            ? t('spots.footprintNone')
            : t('spots.footprintSide', { metres: spot.footprintSide })}
        </span>
        {spot.footprintSide != null && (
          <Button
            size="compact-xs"
            variant="default"
            onClick={spot.clearFootprint}
          >
            {t('spots.footprintClear')}
          </Button>
        )}
      </Group>

      <Group gap="xs" mt="xs" justify="space-between">
        <Tooltip label={drawing ? t('spots.drawStop') : t('spots.drawStart')}>
          <ControlButton
            icon="draw"
            on={drawing}
            aria-label={t('spots.draw')}
            aria-pressed={drawing}
            onClick={() => spot.setStage(drawing ? 'pin' : 'sketch')}
          />
        </Tooltip>
        <span className={styles.coordsText}>
          {spot.hasSketch ? t('spots.sketchPresent') : t('spots.sketchNone')}
        </span>
      </Group>

      {record && <EvidenceStrip spot={record} />}

      {spot.sketchTooBig && (
        <Alert color="red" mt="xs" p="xs">
          {t('spots.sketchTooBig')}
        </Alert>
      )}

      {spot.saveError && (
        <Alert color="red" mt="xs" p="xs">
          {t('spots.saveFailed')}
        </Alert>
      )}
    </Panel>
  );
};
