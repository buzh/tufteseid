// No button lit is `?backgroundLayer=empty`, the one background belonging to no
// ground.

import { Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { ControlButton } from '../ui/ControlButton';
import { ControlUnit } from '../ui/ControlUnit';
import type { MaterialSymbol } from '../ui/Icon';
import {
  GROUND_MODES,
  type GroundControls,
  type GroundMode,
} from './useGroundControls';

const GROUND_ICON: Record<GroundMode, MaterialSymbol> = {
  lidar: 'landscape',
  kart: 'map',
  flyfoto: 'photo_camera',
};

export const GroundSwitch = ({ ground }: { ground: GroundControls }) => {
  const { t } = useTranslation();
  const { mode, select } = ground;

  return (
    <ControlUnit>
      {GROUND_MODES.map((candidate) => (
        <Tooltip
          key={candidate}
          label={t('grounds.tooltip', {
            ground: t(`grounds.${candidate}.name`),
            hint: t(`grounds.${candidate}.hint`),
          })}
        >
          <ControlButton
            icon={GROUND_ICON[candidate]}
            on={candidate === mode}
            aria-label={t(`grounds.${candidate}.name`)}
            aria-pressed={candidate === mode}
            onClick={() => select(candidate)}
          />
        </Tooltip>
      ))}
    </ControlUnit>
  );
};
