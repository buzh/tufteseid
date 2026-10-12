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

// Where Flyfoto sends a reader who may not enter it: the pictures are Norge i
// bilder's, and their own viewer is open to anybody (`src/auth/features.ts`).
const NORGE_I_BILDER = 'https://norgeibilder.no/';

export const GroundSwitch = ({ ground }: { ground: GroundControls }) => {
  const { t } = useTranslation();
  const { mode, select, mayFlyfoto } = ground;

  return (
    <ControlUnit>
      {GROUND_MODES.map((candidate) => {
        const away = candidate === 'flyfoto' && !mayFlyfoto;
        const label = t('grounds.tooltip', {
          ground: t(`grounds.${candidate}.name`),
          hint: away
            ? t('grounds.flyfoto.away')
            : t(`grounds.${candidate}.hint`),
        });
        return (
          <Tooltip key={candidate} label={label}>
            <ControlButton
              icon={GROUND_ICON[candidate]}
              on={candidate === mode}
              aria-label={label}
              // Not a toggle when it leaves the app.
              aria-pressed={away ? undefined : candidate === mode}
              onClick={() =>
                away
                  ? window.open(NORGE_I_BILDER, '_blank', 'noopener,noreferrer')
                  : select(candidate)
              }
            />
          </Tooltip>
        );
      })}
    </ControlUnit>
  );
};
