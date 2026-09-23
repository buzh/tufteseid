import { Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { ControlButton } from '../ui/ControlButton';
import { useTerrainToggle } from './useTerrainToggle';

export const TerrainToggle = () => {
  const { t } = useTranslation();
  const { on, toggle } = useTerrainToggle();

  return (
    <Tooltip label={on ? t('terrainControls.hide') : t('terrainControls.show')}>
      <ControlButton
        icon="elevation"
        on={on}
        aria-label={t('terrainControls.label')}
        aria-pressed={on}
        onClick={toggle}
      />
    </Tooltip>
  );
};
