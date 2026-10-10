// Which ground is up is derived from the half's background layer, never
// stored: a second piece of state could disagree with the map. Entering one is
// the arm's own business, hence the `enter` callbacks rather than a write here.

import { useAtomValue } from 'jotai';
import type { CompareHalf } from '../map/compare/halves';
import type { BackgroundLayerName } from '../map/layers/backgroundLayers';
import { backgroundLayerHalves } from '../map/layers/config/backgroundLayers/atoms';
import { isKartVariant } from '../map/layers/config/backgroundLayers/kartVariants';
import { LIDAR_LAYERS } from '../map/layers/config/backgroundLayers/stack';
import { serviceOn } from '../services';

const GROUND_MODES = ['lidar', 'kart', 'flyfoto'] as const;

export type GroundMode = (typeof GROUND_MODES)[number];

/** What this installation can show, and the order the switch draws them in. */
export const AVAILABLE_GROUND_MODES: readonly GroundMode[] =
  GROUND_MODES.filter((mode) => mode !== 'flyfoto' || serviceOn('flyfoto'));

/** Null for `empty`, the one background that belongs to no ground. */
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
  const mode = groundOf(backgroundLayer);

  return {
    mode,
    // Picking the ground already showing is not a re-entry: it would re-run
    // Automatisk, or drop Flyfoto back to the mosaic, for a click that said
    // nothing.
    select: (next: GroundMode) => {
      if (next !== mode) enter[next]();
    },
  };
};

export type GroundControls = ReturnType<typeof useGroundControls>;
