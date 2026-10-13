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

const ANSWER_TEXT: Record<Answer, string> = {
  copied: 'spots.copied',
  failed: 'spots.copyFailed',
};

export const useShareCopy = (spot: SpotRecord | null) => {
  const { t } = useTranslation();
  const subject = spot?.id ?? null;
  const [last, setLast] = useState<{
    subject: string | null;
    answer: Answer;
  }>();
  const answer = last?.subject === subject ? last.answer : null;

  useEffect(() => {
    if (!last) return;
    const timer = setTimeout(() => setLast(undefined), ANSWER_MS);
    return () => clearTimeout(timer);
  }, [last]);

  const icon: MaterialSymbol = answer ? ANSWER_ICON[answer] : 'share';

  return {
    answer,
    icon,
    answerLabel: answer ? t(ANSWER_TEXT[answer]) : null,
    copy: () => {
      void copyShareLink(spot).then((ok) =>
        setLast({ subject, answer: ok ? 'copied' : 'failed' }),
      );
    },
  };
};
