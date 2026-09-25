// Everything about a spot that is typed rather than dragged, plus the delete.
// The pictures are not here: they belong to `SpotCard`, which is the surface
// the reader works from and the one this box is reached from.

import { Alert, Button, Group, Textarea, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { SPOT_DESCRIPTION_MAX, SPOT_NAME_MAX } from '../api/spots';
import { formatPoint } from '../spots/geo';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { useConfirm } from '../ui/useConfirm';
import styles from './SpotBox.module.css';
import type { SpotDraftController } from './useSpotDraft';

export const SpotEditor = ({ spot }: { spot: SpotDraftController }) => {
  const { t } = useTranslation();
  const placing = spot.stage === 'pin';
  const drawing = spot.stage === 'sketch';
  const framing = spot.stage === 'footprint';
  const sided = spot.footprintSideMetres != null;

  const remove = useConfirm(spot.remove);

  return (
    <Panel
      className={styles.panel}
      icon="add_location"
      title={spot.isNew ? t('spots.newTitle') : t('spots.editTitle')}
      status={spot.busy ? t('spots.saving') : undefined}
      onClose={spot.close}
      unsaved={spot.textDirty}
      footer={
        <>
          <Button
            size="xs"
            mr="auto"
            variant={remove.armed ? 'filled' : 'default'}
            color={remove.armed ? 'red' : undefined}
            loading={spot.deleting}
            onClick={remove.press}
          >
            {remove.armed ? t('spots.deleteConfirm') : t('spots.delete')}
          </Button>
          <Button size="xs" disabled={spot.deleting} onClick={spot.close}>
            {t('spots.done')}
          </Button>
        </>
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

      <div
        className={cx(
          styles.unit,
          styles.unitPlain,
          spot.step === 'description' && styles.unitStep,
        )}
      >
        <Textarea
          size="xs"
          maxLength={SPOT_DESCRIPTION_MAX}
          label={t('spots.description')}
          placeholder={t('spots.descriptionPlaceholder')}
          autosize
          minRows={3}
          maxRows={8}
          value={spot.description}
          onChange={(event) => spot.setDescription(event.currentTarget.value)}
        />
        {spot.textDirty && (
          <Group gap="xs" mt={6} justify="flex-end">
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              onClick={spot.revertText}
            >
              {t('spots.abort')}
            </Button>
            <Button
              size="compact-xs"
              disabled={!spot.canSaveText}
              onClick={spot.saveText}
            >
              {t('spots.save')}
            </Button>
          </Group>
        )}
      </div>

      <div className={cx(styles.unit, placing && styles.unitStep)}>
        <Icon icon="my_location" size={14} />
        <span className={styles.unitText}>{formatPoint(spot.draft.point)}</span>
        <Button
          size="compact-xs"
          variant={placing ? 'filled' : 'default'}
          onClick={() => spot.setStage(placing ? 'idle' : 'pin')}
        >
          {placing ? t('spots.done') : t('spots.change')}
        </Button>
      </div>

      <div
        className={cx(styles.unit, spot.step === 'sketch' && styles.unitStep)}
      >
        {drawing ? (
          <>
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              onClick={spot.cancelSketch}
            >
              {t('spots.abort')}
            </Button>
            <Button size="compact-xs" onClick={spot.saveSketch}>
              {t('spots.save')}
            </Button>
          </>
        ) : (
          <Button
            size="compact-xs"
            variant="default"
            leftSection={<Icon icon="draw" size={14} />}
            onClick={() => spot.setStage('sketch')}
          >
            {spot.hasSketch ? t('spots.sketchChange') : t('spots.sketchAdd')}
          </Button>
        )}
      </div>

      <div className={styles.unit}>
        <Icon icon="crop_free" size={14} />
        <span className={styles.unitText}>
          {framing
            ? t('spots.footprintHint')
            : sided
              ? t('spots.footprintSide', { metres: spot.footprintSideMetres })
              : ''}
        </span>
        <Button
          size="compact-xs"
          variant={framing ? 'filled' : 'default'}
          onClick={() => spot.setStage(framing ? 'idle' : 'footprint')}
        >
          {framing ? t('spots.done') : t('spots.change')}
        </Button>
      </div>

      {spot.footprintClamped && (
        <Alert color="yellow" mt="xs" p="xs">
          {t(`spots.footprintClamped.${spot.footprintClamped}`)}
        </Alert>
      )}

      {spot.sketchTooBig && (
        <Alert color="red" mt="xs" p="xs">
          {t('spots.sketchTooBig')}
        </Alert>
      )}

      {spot.error && (
        <Alert color="red" mt="xs" p="xs">
          {t(
            spot.error === 'delete' ? 'spots.deleteFailed' : 'spots.saveFailed',
          )}
        </Alert>
      )}
    </Panel>
  );
};
