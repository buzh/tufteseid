

import { Tooltip } from '@mantine/core';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { mapAtom } from '../map/atoms';
import { ControlButton } from '../ui/ControlButton';
import { ControlUnit } from '../ui/ControlUnit';
import type { MaterialSymbol } from '../ui/Icon';
import { norgeIBilderUrl } from './norgeIBilder';
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

  const map = useAtomValue(mapAtom);
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

              aria-pressed={away ? undefined : candidate === mode}
              onClick={() =>
                away
                  ? window.open(
                      norgeIBilderUrl(map),
                      '_blank',
                      'noopener,noreferrer',
                    )
                  : select(candidate)
              }
            />
          </Tooltip>
        );
      })}
    </ControlUnit>
  );
};
