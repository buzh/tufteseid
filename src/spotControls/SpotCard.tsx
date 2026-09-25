import { Alert, Button, Group, Switch } from '@mantine/core';
import { useSetAtom } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { deleteSpot, updateSpot, type SpotRecord } from '../api/spots';
import { EvidenceGallery } from '../evidence/EvidenceGallery';
import { isReadable } from '../evidence/labels';
import { useSpotEvidence } from '../evidence/useSpotEvidence';
import { sketchOf } from '../sketch/scene';
import { SketchFade } from '../sketch/SketchFade';
import {
  activeSpotAtom,
  editSpotDraftAtom,
  spotReadingAtom,
} from '../spots/atoms';
import { formatPoint } from '../spots/geo';
import { useMayEditSpot } from '../spots/mayEdit';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { useConfirm } from '../ui/useConfirm';
import styles from './SpotBox.module.css';

type Failure = 'visibility' | 'delete';

// Spelled out so the `t()` keys stay greppable.
const FAILURE_TEXT: Record<Failure, string> = {
  visibility: 'spots.visibilityFailed',
  delete: 'spots.deleteFailed',
};

export const SpotCard = ({ spot }: { spot: SpotRecord }) => {
  const { t } = useTranslation();
  const mayEdit = useMayEditSpot(spot);
  const setActive = useSetAtom(activeSpotAtom);
  const edit = useSetAtom(editSpotDraftAtom);
  const setReading = useSetAtom(spotReadingAtom);

  const evidence = useSpotEvidence(spot);
  const readable = (evidence.items ?? []).filter(isReadable).length;

  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState<Failure | null>(null);

  const setVisibility = (makePublic: boolean) => {
    setBusy(true);
    setFailed(null);
    updateSpot(spot.id, { visibility: makePublic ? 'public' : 'private' })
      .then(setActive)
      .catch((err) => {
        console.warn('[spots] visibility failed', err);
        setFailed('visibility');
      })
      .finally(() => setBusy(false));
  };

  const remove = useConfirm(() => {
    setDeleting(true);
    setFailed(null);
    deleteSpot(spot.id)
      .then(() => setActive(null))
      .catch((err) => {
        console.warn('[spots] delete failed', err);
        setFailed('delete');
        setDeleting(false);
      });
  });

  const hasSketch = sketchOf(spot.sketch) !== null;

  return (
    <Panel
      className={styles.panel}
      icon="location_on"
      title={spot.name}
      onClose={() => setActive(null)}
      footer={
        (readable > 0 || mayEdit) && (
          <>
            {readable > 0 && (
              <Button
                size="xs"
                variant="default"
                leftSection={<Icon icon="menu_book" size={16} />}
                onClick={() => setReading(true)}
              >
                {t('evidence.read')}
              </Button>
            )}
            {mayEdit && (
              <Group gap="xs" ml="auto">
                <Button
                  size="xs"
                  variant={remove.armed ? 'filled' : 'default'}
                  color={remove.armed ? 'red' : undefined}
                  loading={deleting}
                  onClick={remove.press}
                >
                  {remove.armed ? t('spots.deleteConfirm') : t('spots.delete')}
                </Button>
                <Button
                  size="xs"
                  disabled={busy || deleting}
                  onClick={() => edit(spot)}
                >
                  {t('spots.edit')}
                </Button>
              </Group>
            )}
          </>
        )
      }
    >
      {spot.description && <p className={styles.prose}>{spot.description}</p>}

      <div className={styles.meta}>
        {spot.credit && <div>{t('spots.credit', { name: spot.credit })}</div>}
        <div>{formatPoint(spot.point)}</div>
      </div>

      {hasSketch && <SketchFade className={styles.sketchFade} />}

      {mayEdit && (
        <Switch
          mt="xs"
          size="xs"
          disabled={busy || deleting}
          checked={spot.visibility === 'public'}
          label={t('spots.public')}
          description={t('spots.publicHint')}
          onChange={(event) => setVisibility(event.currentTarget.checked)}
        />
      )}

      <EvidenceGallery spot={spot} evidence={evidence} />

      {failed && (
        <Alert color="red" mt="xs" p="xs">
          {t(FAILURE_TEXT[failed])}
        </Alert>
      )}
    </Panel>
  );
};
