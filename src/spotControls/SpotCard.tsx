import { Alert, Button, Group, Switch, Tooltip } from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { deleteSpot, updateSpot, type SpotRecord } from '../api/spots';
import { currentUserAtom, isAdminAtom } from '../auth/atoms';
import { EvidenceGallery } from '../evidence/EvidenceGallery';
import { activeSpotAtom, editSpotDraftAtom } from '../spots/atoms';
import { formatPoint } from '../spots/geo';
import { copyShareLink } from '../spots/shareLink';
import { ControlButton } from '../ui/ControlButton';
import { Panel } from '../ui/Panel';
import { useConfirm } from '../ui/useConfirm';
import styles from './SpotBox.module.css';

type Failure = 'visibility' | 'delete' | 'copy';

// Spelled out so the `t()` keys stay greppable.
const FAILURE_TEXT: Record<Failure, string> = {
  visibility: 'spots.visibilityFailed',
  delete: 'spots.deleteFailed',
  copy: 'spots.copyFailed',
};

const COPIED_MS = 2000;

export const SpotCard = ({ spot }: { spot: SpotRecord }) => {
  const { t } = useTranslation();
  const user = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const setActive = useSetAtom(activeSpotAtom);
  const edit = useSetAtom(editSpotDraftAtom);

  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState<Failure | null>(null);

  // Owner or admin, matching what the server enforces on update and delete.
  const mayEdit = user != null && (user.id === spot.owner || isAdmin);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

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

  return (
    <Panel
      className={styles.panel}
      icon="location_on"
      title={spot.name}
      onClose={() => setActive(null)}
      footer={
        <>
          <Tooltip label={copied ? t('spots.copied') : t('spots.copyLink')}>
            <ControlButton
              icon={copied ? 'link' : 'content_copy'}
              on={copied}
              aria-label={t('spots.copyLink')}
              onClick={() => {
                void copyShareLink(spot).then((ok) => {
                  setCopied(ok);
                  if (!ok) setFailed('copy');
                });
              }}
            />
          </Tooltip>
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
      }
    >
      {spot.description && <p className={styles.prose}>{spot.description}</p>}

      <div className={styles.meta}>
        {spot.credit && <div>{t('spots.credit', { name: spot.credit })}</div>}
        <div>{formatPoint(spot.point)}</div>
      </div>

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

      <EvidenceGallery spot={spot} />

      {failed && (
        <Alert color="red" mt="xs" p="xs">
          {t(FAILURE_TEXT[failed])}
        </Alert>
      )}
    </Panel>
  );
};
