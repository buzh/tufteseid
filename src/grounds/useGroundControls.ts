// Which of the three grounds the map is reading, and the one move between them.
//
// A ground is a family of background layers rather than a layer: LiDAR is the
// national mosaic plus every acquisition under either of its two renders, Kart
// is the five cartographies, Flyfoto is the seamless ortofoto mosaic plus every
// NiB acquisition. A half of `backgroundLayerHalves` holds one member of one
// family, so which family it belongs to is derived here and never stored — a
// second piece of state would be one that can disagree with what is on the map.
//
// One of these per half that is drawing: the band mounts a ground section for
// the left of the screen and, in a two-ground view, a second for the right.
//
// The membership tests are the vocabularies the layer code already keeps
// (`LIDAR_LAYERS`, `isKartVariant`), not a table of names in here, so a ground
// that gains a member gains it in one place.
//
// Entering a ground is the arm's own business, because each arm remembers
// something different: Kart returns to the variant you left, LiDAR re-decides
// through Automatisk, Flyfoto lands on the mosaic because it is the only member
// that draws everywhere. So this takes the three entry points rather than
// writing the background atom itself.

import { useAtomValue } from 'jotai';
import type { CompareHalf } from '../map/compare/halves';
import type { BackgroundLayerName } from '../map/layers/backgroundLayers';
import { backgroundLayerHalves } from '../map/layers/config/backgroundLayers/atoms';
import { isKartVariant } from '../map/layers/config/backgroundLayers/kartVariants';
import { LIDAR_LAYERS } from '../map/layers/config/backgroundLayers/stack';

// The order the menu lists them in: relief first, because reading it is what
// the app is for; then the map that says what the relief is of; then the
// photograph of it.
export const GROUND_MODES = ['lidar', 'kart', 'flyfoto'] as const;

export type GroundMode = (typeof GROUND_MODES)[number];

/** Null for `empty`, the one background that belongs to no ground. */
export const groundOf = (name: BackgroundLayerName): GroundMode | null => {
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
    // Automatisk, or move Flyfoto off an acquisition back onto the mosaic, for
    // a click that said nothing.
    select: (next: GroundMode) => {
      if (next !== mode) enter[next]();
    },
  };
};

export type GroundControls = ReturnType<typeof useGroundControls>;
