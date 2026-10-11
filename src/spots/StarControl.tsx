// An author may star their own spot — it is the favourites list that reads it
// — but the tally leaves it out, so the number on one's own card can sit at
// zero with the star lit (`docs/votes.md`).

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

  // Absent from the view means nobody has starred it, not an unknown tally.
  const stars = counts?.get(spot.id)?.stars ?? 0;
  const mine = myStars?.get(spot.id);

  const needsAccount = user == null;
  // An admin cannot publish somebody else's spot, but a reader with no
  // account can get one, so only the first refusal is a dead end.
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
    // The realtime feed carries the result back into `myStarsAtom` and
    // refetches the tally, so there is nothing to set here.
    void (mine ? removeStar(mine.id) : addStar(spot.id, user.id))
      .catch((err) => console.warn('[stars] toggle failed', err))
      .finally(() => setBusy(false));
  };

  return (
    // The outer tooltip stands on a span: a disabled button fires no pointer
    // events, so one on the button itself would never open.
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
          // `total`, not `count`: i18next reads `count` as a request for
          // plural forms this key has none of.
          title={t('spots.starCount', { total: stars })}
        >
          {stars}
        </span>
      </span>
    </Tooltip>
  );
};
