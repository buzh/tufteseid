// Two pieces of state: the background half is what is on the map, the variant
// half is what Kart means while another ground is up.

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

  // Picking a variant enters Kart as well as naming it.
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
