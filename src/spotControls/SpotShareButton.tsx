// The share link, in the title row of whichever box has the spot open. Its own
// state: copying is a gesture with an answer, not something the box saves.

import { ActionIcon, Tooltip } from '@mantine/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SpotRecord } from '../api/spots';
import { copyShareLink } from '../spots/shareLink';
import { Icon, type MaterialSymbol } from '../ui/Icon';

type Answer = 'copied' | 'failed';

const ANSWER_MS = 2000;

const ANSWER_ICON: Record<Answer, MaterialSymbol> = {
  copied: 'link',
  failed: 'link_off',
};

// Spelled out so the `t()` keys stay greppable.
const ANSWER_TEXT: Record<Answer, string> = {
  copied: 'spots.copied',
  failed: 'spots.copyFailed',
};

export const SpotShareButton = ({ spot }: { spot: SpotRecord }) => {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (!answer) return;
    const timer = setTimeout(() => setAnswer(null), ANSWER_MS);
    return () => clearTimeout(timer);
  }, [answer]);

  const label = t(answer ? ANSWER_TEXT[answer] : 'spots.copyLink');

  return (
    <Tooltip label={label}>
      <ActionIcon
        variant={answer ? 'filled' : 'subtle'}
        color={answer === 'failed' ? 'red' : answer ? 'papaya' : 'gray'}
        size="sm"
        aria-label={label}
        onClick={() => {
          void copyShareLink(spot).then((ok) =>
            setAnswer(ok ? 'copied' : 'failed'),
          );
        }}
      >
        <Icon icon={answer ? ANSWER_ICON[answer] : 'share'} size={18} />
      </ActionIcon>
    </Tooltip>
  );
};
