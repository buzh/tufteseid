import { Tooltip } from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SpotRecord } from '../api/spots';
import { addStar, removeStar } from '../api/stars';
import { currentUserAtom, isAuthDialogOpenAtom } from '../auth/atoms';
import { ControlButton } from '../ui/ControlButton';
import { myStarsAtom, starCountsAtom } from './spotStars';
import styles from './tally.module.css';

export const StarControl = ({ spot }: { spot: SpotRecord }) => {
  const { t } = useTranslation();
  const user = useAtomValue(currentUserAtom);
  const openAuthDialog = useSetAtom(isAuthDialogOpenAtom);
  const counts = useAtomValue(starCountsAtom);
  const myStars = useAtomValue(myStarsAtom);
  const [busy, setBusy] = useState(false);

  const stars = counts?.get(spot.id)?.stars ?? 0;
  const mine = myStars?.get(spot.id);

  const needsAccount = user == null;
  const dead = !needsAccount && spot.visibility !== 'public';
  const hint = needsAccount
    ? t('spots.starNeedsAccount')
    : dead
      ? t('spots.starPrivate')
      : null;

  const own = user != null && spot.owner === user.id;
  const label = own
    ? t('spots.starOwn')
    : mine
      ? t('spots.starRemove')
      : t('spots.starAdd');

  const toggle = () => {
    if (needsAccount) {
      openAuthDialog(true);
      return;
    }
    if (!user || busy) return;
    setBusy(true);
    void (mine ? removeStar(mine.id) : addStar(spot.id, user.id))
      .catch((err) => console.warn('[stars] toggle failed', err))
      .finally(() => setBusy(false));
  };

  return (
    <Tooltip label={hint} disabled={hint == null}>
      <span className={styles.group}>
        <Tooltip label={label} disabled={hint != null}>
          <ControlButton
            icon="star"
            on={mine != null}
            aria-label={label}
            aria-pressed={mine != null}
            disabled={dead || busy}
            onClick={toggle}
          />
        </Tooltip>
        <span
          className={styles.tally}
          title={t('spots.starCount', { total: stars })}
        >
          {stars}
        </span>
      </span>
    </Tooltip>
  );
};
