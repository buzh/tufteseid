

import { useAtomValue } from 'jotai';
import { useHasFeature } from '../auth/features';
import type { CompareHalf } from '../map/compare/halves';
import type { BackgroundLayerName } from '../map/layers/backgroundLayers';
import { backgroundLayerHalves } from '../map/layers/config/backgroundLayers/atoms';
import { isKartVariant } from '../map/layers/config/backgroundLayers/kartVariants';
import { LIDAR_LAYERS } from '../map/layers/config/backgroundLayers/stack';

export const GROUND_MODES = ['lidar', 'kart', 'flyfoto'] as const;

export type GroundMode = (typeof GROUND_MODES)[number];

const groundOf = (name: BackgroundLayerName): GroundMode | null => {
  if (LIDAR_LAYERS.has(name)) return 'lidar';
  if (isKartVariant(name)) return 'kart';
  if (name === 'flyfoto' || name === 'flyfotoProject') return 'flyfoto';
  return null;
};

export const useGroundControls = (
  half: CompareHalf,
  enter: Record<GroundMode, () => void>,
) => {
  const backgroundLayer = useAtomValue(backgroundLayerHalves[half]);
  const mayFlyfoto = useHasFeature('flyfoto');
  const mode = groundOf(backgroundLayer);

  return {
    mode,
    mayFlyfoto,

    select: (next: GroundMode) => {
      if (next === 'flyfoto' && !mayFlyfoto) return;
      if (next !== mode) enter[next]();
    },
  };
};

export type GroundControls = ReturnType<typeof useGroundControls>;
