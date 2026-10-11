import { Tooltip } from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { ControlButton } from '../ui/ControlButton';
import { armPlaceInfoAtom, placeInfoArmedAtom } from './atoms';

export const PlaceInfoToggle = () => {
  const { t } = useTranslation();
  const armed = useAtomValue(placeInfoArmedAtom);
  const arm = useSetAtom(armPlaceInfoAtom);

  return (
    <Tooltip label={armed ? t('placeInfo.cancel') : t('placeInfo.label')}>
      <ControlButton
        icon="not_listed_location"
        on={armed}
        aria-label={t('placeInfo.label')}
        aria-pressed={armed}
        onClick={() => arm(!armed)}
      />
    </Tooltip>
  );
};
