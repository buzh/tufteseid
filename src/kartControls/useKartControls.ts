// The Kart arm's controller. One axis — which cartography — and two pieces of
// state on purpose.
//
// The background half is what is on the map; the variant half is what Kart
// *means*. They diverge the moment another ground is up, and that divergence is
// the point: coming back to Kart from LiDAR returns to the map you left rather
// than to topo. Both are per half, so the two panes of a two-ground view
// remember their own cartography.

import { useAtom } from 'jotai';
import type { CompareHalf } from '../map/compare/halves';
import { backgroundLayerHalves } from '../map/layers/config/backgroundLayers/atoms';
import {
  isKartVariant,
  kartVariantHalves,
  type KartVariant,
} from '../map/layers/config/backgroundLayers/kartVariants';

export const useKartControls = (half: CompareHalf) => {
  const [backgroundLayer, setBackgroundLayer] = useAtom(
    backgroundLayerHalves[half],
  );
  const [variant, setVariant] = useAtom(kartVariantHalves[half]);

  const isKartBackground = isKartVariant(backgroundLayer);
  // The background where it is one of ours, the remembered pick otherwise.
  const active: KartVariant = isKartBackground ? backgroundLayer : variant;

  // Picking a variant enters Kart as well as naming it: the menu is only on
  // screen while Kart is the ground, but a pick made the instant the ground
  // switch lands would otherwise write the name and not the map.
  const activate = (next: KartVariant) => {
    setVariant(next);
    setBackgroundLayer(next);
  };

  return {
    active,
    activate,
    // Not a pick, so it leaves the remembered variant alone.
    enterKart: () => {
      if (!isKartBackground) setBackgroundLayer(variant);
    },
  };
};

export type KartControls = ReturnType<typeof useKartControls>;
