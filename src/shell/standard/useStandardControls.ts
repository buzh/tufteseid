import { useAtom } from 'jotai';
import { useState } from 'react';
import { backgroundLayerAtom } from '../../map/layers/config/backgroundLayers/atoms';
import {
  isStandardVariant,
  STANDARD_VARIANTS,
  standardVariantAtom,
  type StandardVariant,
} from '../../map/layers/config/backgroundLayers/standardVariants';
import type { CycleKey } from '../../map/useBackgroundCyclingKeys';

/**
 * Mount once, from RibbonGlobalRow. Two pieces of state on purpose:
 * `backgroundLayerAtom` is what is on the map, `standardVariantAtom` is what
 * Standard means, and they diverge while another ground is up so pressing 1
 * returns to the map you left.
 */
export const useStandardControls = () => {
  const [backgroundLayer, setBackgroundLayer] = useAtom(backgroundLayerAtom);
  const [variant, setVariant] = useAtom(standardVariantAtom);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isStandardBackground = isStandardVariant(backgroundLayer);
  // The background when it is one of ours, the remembered pick otherwise.
  const active: StandardVariant = isStandardBackground
    ? backgroundLayer
    : variant;

  const select = (next: StandardVariant) => {
    setVariant(next);
    setBackgroundLayer(next);
  };

  // A row click picks and dismisses; W/S below picks without closing.
  const activate = (next: StandardVariant) => {
    select(next);
    setPickerOpen(false);
  };

  // No `standDown`: this pulldown hangs off the always-mounted `Kart` button,
  // and closing it from useGroundMode would make it unopenable elsewhere.

  const cycle = (key: CycleKey): boolean => {
    if (key !== 'w' && key !== 's') return false;
    const step = key === 's' ? 1 : -1;
    const at = STANDARD_VARIANTS.indexOf(active);
    const ring = STANDARD_VARIANTS.length;
    select(STANDARD_VARIANTS[(at + step + ring) % ring]);
    return true;
  };

  return {
    cycle,
    isStandardBackground,
    active,
    pickerOpen,
    setPickerOpen,
    activate,
    // Not a pick, so it leaves the remembered variant alone.
    enterStandard: () => {
      if (!isStandardBackground) setBackgroundLayer(variant);
    },
  };
};

export type StandardControls = ReturnType<typeof useStandardControls>;
