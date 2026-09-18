import { useAtom } from 'jotai';
import { useState } from 'react';
import { backgroundLayerAtom } from '../../map/layers/config/backgroundLayers/atoms';
import {
  isKartVariant,
  KART_VARIANTS,
  kartVariantAtom,
  type KartVariant,
} from '../../map/layers/config/backgroundLayers/kartVariants';
import type { CycleKey } from '../../map/useBackgroundCyclingKeys';

/**
 * Mount once, from RibbonGlobalRow. Two pieces of state on purpose:
 * `backgroundLayerAtom` is what is on the map, `kartVariantAtom` is what
 * Kart means, and they diverge while another ground is up so pressing 2
 * returns to the map you left.
 */
export const useKartControls = () => {
  const [backgroundLayer, setBackgroundLayer] = useAtom(backgroundLayerAtom);
  const [variant, setVariant] = useAtom(kartVariantAtom);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isKartBackground = isKartVariant(backgroundLayer);
  // The background when it is one of ours, the remembered pick otherwise.
  const active: KartVariant = isKartBackground ? backgroundLayer : variant;

  const select = (next: KartVariant) => {
    setVariant(next);
    setBackgroundLayer(next);
  };

  // A row click picks and dismisses; W/S below picks without closing.
  const activate = (next: KartVariant) => {
    select(next);
    setPickerOpen(false);
  };

  // No `standDown`: this pulldown hangs off the always-mounted `Kart` button,
  // and closing it from useGroundMode would make it unopenable elsewhere.

  const cycle = (key: CycleKey): boolean => {
    if (key !== 'w' && key !== 's') return false;
    const step = key === 's' ? 1 : -1;
    const at = KART_VARIANTS.indexOf(active);
    const ring = KART_VARIANTS.length;
    select(KART_VARIANTS[(at + step + ring) % ring]);
    return true;
  };

  return {
    cycle,
    isKartBackground,
    active,
    pickerOpen,
    setPickerOpen,
    activate,
    // Not a pick, so it leaves the remembered variant alone.
    enterKart: () => {
      if (!isKartBackground) setBackgroundLayer(variant);
    },
  };
};

export type KartControls = ReturnType<typeof useKartControls>;
