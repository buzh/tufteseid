// The box a draft is written in: the name the register guessed, a description,
// where the pin is, and the verb that ends the draft.
//
// Four things in a fixed order, and the order is the workflow: what it is
// called, what you saw, where it is, what you drew. The coordinate is late
// because it is the one field the reader does not type, and because by the time
// this box exists they have already aimed it — the box opens on the click that
// placed the pin. `Endre` is there for the nudge afterwards.
//
// The way out is the box's own close and not a second button beside `Lagre`:
// one abandon verb, in the corner every other box has it in, and it asks twice
// while there is anything written in here to lose (`dirty` in the controller,
// `unsaved` on the `Panel`).

import { Alert, Button, Group, Textarea, TextInput, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { SPOT_DESCRIPTION_MAX, SPOT_NAME_MAX } from '../api/spots';
import { cx } from '../ui/cx';
import { ControlButton } from '../ui/ControlButton';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { formatPoint } from '../spots/geo';
import styles from './SpotBox.module.css';
import type { SpotDraftController } from './useSpotDraft';

export const SpotPanel = ({ spot }: { spot: SpotDraftController }) => {
  const { t } = useTranslation();
  const placing = spot.stage === 'pin';
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
      {/* Capped at the column's own width, like the drawing is: the reader
          finds out while they are typing rather than from a failed save. */}
      <TextInput
        size="xs"
        maxLength={SPOT_NAME_MAX}
        label={t('spots.name')}
        placeholder={
          spot.suggesting ? t('spots.namePlaceholderBusy') : t('spots.namePlaceholder')
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

      {/* The coordinate reads live while the pin is in hand, which is what
          makes the map and the box one instrument rather than two. */}
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
          label={drawing ? t('spots.drawStop') : t('spots.drawStart')}
        >
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
