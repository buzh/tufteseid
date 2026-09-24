import { ActionIcon, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import type { SpotRecord } from '../api/spots';
import { useShareCopy } from '../spots/useShareCopy';
import { Icon } from '../ui/Icon';

export const SpotShareButton = ({ spot }: { spot: SpotRecord }) => {
  const { t } = useTranslation();
  const { answer, icon, answerLabel, copy } = useShareCopy(spot);

  const label = answerLabel ?? t('spots.copyLink');

  return (
    <Tooltip label={label}>
      <ActionIcon
        variant={answer ? 'filled' : 'subtle'}
        color={answer === 'failed' ? 'red' : answer ? 'papaya' : 'gray'}
        size="sm"
        aria-label={label}
        onClick={copy}
      >
        <Icon icon={icon} size={18} />
      </ActionIcon>
    </Tooltip>
  );
};
