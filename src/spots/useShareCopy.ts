// The copy gesture and its answer, shared by the button in a spot's title row
// and the one in the ribbon.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SpotRecord } from '../api/spots';
import type { MaterialSymbol } from '../ui/Icon';
import { copyShareLink } from './shareLink';

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

export const useShareCopy = (spot: SpotRecord | null) => {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (!answer) return;
    const timer = setTimeout(() => setAnswer(null), ANSWER_MS);
    return () => clearTimeout(timer);
  }, [answer]);

  const icon: MaterialSymbol = answer ? ANSWER_ICON[answer] : 'share';

  return {
    answer,
    icon,
    /** Null while idle: the caller names what the link points at. */
    answerLabel: answer ? t(ANSWER_TEXT[answer]) : null,
    copy: () => {
      void copyShareLink(spot).then((ok) => setAnswer(ok ? 'copied' : 'failed'));
    },
  };
};
