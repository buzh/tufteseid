// A spot being read: what the author called it, what they wrote, and the verbs
// that belong to whoever is looking at it.
//
// The same box as the draft panel, one step later — a spot saved from the panel
// opens here, which is where its link is and where it is made public. That
// order is deliberate: a spot is private when it is written, and sharing it is
// a second, separate decision taken once there is something to share.
//
// Only one of the two is ever up. The card stands down while a draft is open,
// because a draft is the thing the reader is doing.

import { Alert, Button, Group, Switch, Tooltip } from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { deleteSpot, updateSpot, type SpotRecord } from '../api/spots';
import { currentUserAtom, isAdminAtom } from '../auth/atoms';
import { activeSpotAtom, editSpotDraftAtom } from '../spots/atoms';
import { formatPoint } from '../spots/geo';
import { copyShareLink } from '../spots/shareLink';
import { ControlButton } from '../ui/ControlButton';
import { Panel } from '../ui/Panel';
import { useConfirm } from '../ui/useConfirm';
import styles from './SpotBox.module.css';

type Failure = 'visibility' | 'delete' | 'copy';

// Spelled out rather than interpolated into `t()`, so the keys can be found by
// grepping for them.
const FAILURE_TEXT: Record<Failure, string> = {
  visibility: 'spots.visibilityFailed',
  delete: 'spots.deleteFailed',
  copy: 'spots.copyFailed',
};

/** How long the copy button says it copied. Long enough to be read, short
 *  enough that the next click gets an acknowledgement of its own. */
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

  // Owner or admin, the same product the server enforces: an admin can reshape
  // and delete anybody's spot. `mayAdd` has no counterpart here — a card adds
  // nothing.
  const mayEdit = user != null && (user.id === spot.owner || isAdmin);

  // An acknowledgement, not a mode: nothing else takes it down, so it takes
  // itself down. The cleanup covers the card being closed.
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

  // Two clicks rather than a dialog: the card is already a small box over the
  // map, and a modal on top of it to ask one question is furniture for the sake
  // of ceremony. The same machine guards the close on a draft with unsaved work
  // in it.
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
          {/* Everyone gets the link, not just the owner: a visitor who was sent
              one is exactly the person likely to pass it on. Whether it opens
              for the next reader is the switch above, not this button. */}
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

      {failed && (
        <Alert color="red" mt="xs" p="xs">
          {t(FAILURE_TEXT[failed])}
        </Alert>
      )}
    </Panel>
  );
};
