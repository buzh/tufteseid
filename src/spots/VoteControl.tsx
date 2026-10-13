import { Tooltip } from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SpotRecord } from '../api/spots';
import { castVote, retractVote, type VoteDirection } from '../api/votes';
import { currentUserAtom, isAuthDialogOpenAtom } from '../auth/atoms';
import { ControlButton } from '../ui/ControlButton';
import { myVotesAtom, spotScoresAtom } from './spotScores';
import styles from './tally.module.css';

export const VoteControl = ({ spot }: { spot: SpotRecord }) => {
  const { t } = useTranslation();
  const user = useAtomValue(currentUserAtom);
  const openAuthDialog = useSetAtom(isAuthDialogOpenAtom);
  const scores = useAtomValue(spotScoresAtom);
  const myVotes = useAtomValue(myVotesAtom);
  const [busy, setBusy] = useState(false);

  const score = scores?.get(spot.id)?.score ?? 0;

  const tally = (
    <span
      className={styles.tally}
      title={t('spots.voteScore', { total: score })}
    >
      {score}
    </span>
  );

  if (user != null && spot.owner === user.id) {
    return <span className={styles.group}>{tally}</span>;
  }

  const mine = myVotes.get(spot.id);
  const needsAccount = user == null;
  const dead = !needsAccount && spot.visibility !== 'public';
  const hint = needsAccount
    ? t('spots.voteNeedsAccount')
    : dead
      ? t('spots.votePrivate')
      : null;

  const cast = (direction: VoteDirection) => {
    if (needsAccount) {
      openAuthDialog(true);
      return;
    }
    if (!user || busy) return;
    setBusy(true);
    const done =
      mine?.direction === direction
        ? retractVote(mine.id)
        : castVote(spot.id, user.id, direction);
    void done
      .catch((err) => console.warn('[votes] cast failed', err))
      .finally(() => setBusy(false));
  };

  return (
    <Tooltip label={hint} disabled={hint == null}>
      <span className={styles.group}>
        <Tooltip label={t('spots.voteUp')} disabled={hint != null}>
          <ControlButton
            icon="thumb_up"
            on={mine?.direction === 'up'}
            aria-label={t('spots.voteUp')}
            aria-pressed={mine?.direction === 'up'}
            disabled={dead || busy}
            onClick={() => cast('up')}
          />
        </Tooltip>
        {tally}
        <Tooltip label={t('spots.voteDown')} disabled={hint != null}>
          <ControlButton
            icon="thumb_down"
            on={mine?.direction === 'down'}
            aria-label={t('spots.voteDown')}
            aria-pressed={mine?.direction === 'down'}
            disabled={dead || busy}
            onClick={() => cast('down')}
          />
        </Tooltip>
      </span>
    </Tooltip>
  );
};
