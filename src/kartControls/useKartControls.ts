

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

  const active: KartVariant = isKartBackground ? backgroundLayer : variant;

  const activate = (next: KartVariant) => {
    setVariant(next);
    setBackgroundLayer(next);
  };

  return {
    active,
    activate,

    enterKart: () => {
      if (!isKartBackground) setBackgroundLayer(variant);
    },
  };
};

export type KartControls = ReturnType<typeof useKartControls>;
