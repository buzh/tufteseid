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
import { Icon } from '../ui/Icon';
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

/** How long a delete stays armed. A red button left armed for the rest of the
 *  card's life turns a stray click minutes later into a deletion. */
const CONFIRM_MS = 5000;

export const SpotCard = ({ spot }: { spot: SpotRecord }) => {
  const { t } = useTranslation();
  const user = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const setActive = useSetAtom(activeSpotAtom);
  const edit = useSetAtom(editSpotDraftAtom);

  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Two clicks rather than a dialog: the card is already a small box over the
  // map, and a modal on top of it to ask one question is furniture for the sake
  // of ceremony.
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState<Failure | null>(null);

  // Owner or admin, the same product the server enforces: an admin can reshape
  // and delete anybody's spot. `mayAdd` has no counterpart here — a card adds
  // nothing.
  const mayEdit = user != null && (user.id === spot.owner || isAdmin);

  // Both of these are acknowledgements, not modes: nothing else takes them
  // down, so they take themselves down. The cleanup covers the card being
  // closed, and the delete that actually goes through.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    // Not while the delete is in flight: disarming under a request that is
    // about to finish would put "Slett" back on a button that is deleting.
    if (!confirming || busy) return;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming, busy]);

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

  const remove = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setFailed(null);
    deleteSpot(spot.id)
      .then(() => setActive(null))
      .catch((err) => {
        console.warn('[spots] delete failed', err);
        setFailed('delete');
        setBusy(false);
        setConfirming(false);
      });
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <Icon icon="location_on" size={16} />
        <span className={styles.title}>{spot.name}</span>
        <ControlButton
          icon="close"
          aria-label={t('spots.close')}
          onClick={() => setActive(null)}
        />
      </div>

      <div className={styles.body}>
        {spot.description && <p className={styles.prose}>{spot.description}</p>}

        <div className={styles.meta}>
          {spot.credit && (
            <div>{t('spots.credit', { name: spot.credit })}</div>
          )}
          <div>{formatPoint(spot.point)}</div>
        </div>

        {mayEdit && (
          <Switch
            mt="xs"
            size="xs"
            disabled={busy}
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
      </div>

      <div className={styles.actions}>
        {/* Everyone gets the link, not just the owner: a visitor who was sent
            one is exactly the person likely to pass it on. Whether it opens for
            the next reader is the switch above, not this button. */}
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
              variant={confirming ? 'filled' : 'default'}
              color={confirming ? 'red' : undefined}
              loading={busy && confirming}
              onClick={remove}
            >
              {confirming ? t('spots.deleteConfirm') : t('spots.delete')}
            </Button>
            <Button size="xs" disabled={busy} onClick={() => edit(spot)}>
              {t('spots.edit')}
            </Button>
          </Group>
        )}
      </div>
    </div>
  );
};
