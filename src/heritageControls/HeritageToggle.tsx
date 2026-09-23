import { Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { ControlButton } from '../ui/ControlButton';
import type { HeritageControls } from './useHeritageControls';

export const HeritageToggle = ({
  heritage,
}: {
  heritage: HeritageControls;
}) => {
  const { t } = useTranslation();
  const { shown, toggleShown } = heritage;

  return (
    <Tooltip
      label={shown ? t('heritageControls.hide') : t('heritageControls.show')}
    >
      <ControlButton
        icon="castle"
        on={shown}
        aria-label={t('heritageControls.label')}
        aria-pressed={shown}
        onClick={toggleShown}
      />
    </Tooltip>
  );
};
