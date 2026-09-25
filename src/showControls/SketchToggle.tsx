import { Tooltip } from '@mantine/core';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import { sketchOnGroundAtom, sketchShownAtom } from '../sketch/overlay';
import { ControlButton } from '../ui/ControlButton';

export const SketchToggle = () => {
  const { t } = useTranslation();
  const onGround = useAtomValue(sketchOnGroundAtom);
  const [shown, setShown] = useAtom(sketchShownAtom);

  const on = onGround && shown;
  const label = !onGround
    ? t('spots.sketchNone')
    : shown
      ? t('spots.sketchHide')
      : t('spots.sketchShow');

  return (
    <Tooltip label={label}>
      <ControlButton
        icon="gesture"
        on={on}
        disabled={!onGround}
        aria-label={t('spots.sketchLabel')}
        aria-pressed={on}
        onClick={() => setShown(!shown)}
      />
    </Tooltip>
  );
};
