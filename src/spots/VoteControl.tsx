// Up, the tally, down. Never hidden, only disabled, with the reason on the
// tooltip. Pressing the side already voted retracts it.

import { Tooltip } from '@mantine/core';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SpotRecord } from '../api/spots';
import { castVote, retractVote, type VoteDirection } from '../api/votes';
import { currentUserAtom } from '../auth/atoms';
import { ControlButton } from '../ui/ControlButton';
import { myVotesAtom, spotScoresAtom } from './spotScores';
import styles from './VoteControl.module.css';

export const VoteControl = ({ spot }: { spot: SpotRecord }) => {
  const { t } = useTranslation();
  const user = useAtomValue(currentUserAtom);
  const scores = useAtomValue(spotScoresAtom);
  const myVotes = useAtomValue(myVotesAtom);
  const [busy, setBusy] = useState(false);

  const mine = myVotes.get(spot.id);
  // Absent from the view means nobody has voted, not that the tally is unknown.
  const score = scores?.get(spot.id)?.score ?? 0;

  const isPublic = spot.visibility === 'public';
  const blocked = !user
    ? t('spots.voteNeedsAccount')
    : !isPublic
      ? t('spots.votePrivate')
      : null;

  const cast = (direction: VoteDirection) => {
    if (!user || busy) return;
    setBusy(true);
    const done =
      mine?.direction === direction
        ? retractVote(mine.id)
        : castVote(spot.id, user.id, direction);
    // The realtime feed carries the result back into `myVotesAtom` and
    // refetches the tally, so there is nothing to set here.
    void done
      .catch((err) => console.warn('[votes] cast failed', err))
      .finally(() => setBusy(false));
  };

  return (
    // The outer tooltip stands on a span: a disabled button fires no pointer
    // events, so one on the button itself would never open.
    <Tooltip label={blocked} disabled={blocked == null}>
      <span className={styles.group}>
        <Tooltip label={t('spots.voteUp')} disabled={blocked != null}>
          <ControlButton
            icon="thumb_up"
            on={mine?.direction === 'up'}
            aria-label={t('spots.voteUp')}
            aria-pressed={mine?.direction === 'up'}
            disabled={blocked != null || busy}
            onClick={() => cast('up')}
          />
        </Tooltip>
        <span
          className={styles.score}
          // `total`, not `count`: i18next reads `count` as a request for
          // plural forms this key has none of.
          title={t('spots.voteScore', { total: score })}
        >
          {score}
        </span>
        <Tooltip label={t('spots.voteDown')} disabled={blocked != null}>
          <ControlButton
            icon="thumb_down"
            on={mine?.direction === 'down'}
            aria-label={t('spots.voteDown')}
            aria-pressed={mine?.direction === 'down'}
            disabled={blocked != null || busy}
            onClick={() => cast('down')}
          />
        </Tooltip>
      </span>
    </Tooltip>
  );
};
