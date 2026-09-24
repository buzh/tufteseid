// Hands over whatever the reader is looking at: the open spot's short link, or
// the view itself when no spot is open.

import { Tooltip } from '@mantine/core';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import { activeSpotAtom } from '../spots/atoms';
import { useShareCopy } from '../spots/useShareCopy';
import { ControlButton } from '../ui/ControlButton';

export const ShareButton = () => {
  const { t } = useTranslation();
  const spot = useAtomValue(activeSpotAtom);
  const { answer, icon, answerLabel, copy } = useShareCopy(spot);

  const label =
    answerLabel ?? t(spot ? 'ribbon.shareSpot' : 'ribbon.shareView');

  return (
    <Tooltip label={label}>
      <ControlButton
        icon={icon}
        on={answer === 'copied'}
        aria-label={label}
        onClick={copy}
      />
    </Tooltip>
  );
};
