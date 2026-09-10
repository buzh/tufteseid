import { useAtom } from 'jotai';
import { useCallback, useState } from 'react';
import { backgroundLayerAtom } from '../../map/layers/config/backgroundLayers/atoms';
import {
  isStandardVariant,
  STANDARD_VARIANTS,
  standardVariantAtom,
  type StandardVariant,
} from '../../map/layers/config/backgroundLayers/standardVariants';
import type { CycleKey } from '../../map/useBackgroundCyclingKeys';

/**
 * The Standard ground's own controls: which of the five cartographies is
 * drawing the map, and the W/S ring over them.
 *
 * The simplest of the three control hooks by a wide margin, and it is worth
 * saying why rather than looking for the machinery the other two have. There
 * is no viewport query, no relevance ranking and no footprints, because the
 * list does not depend on where you are looking: all five are national
 * products, the same five everywhere, known at build time. Amtskart is the
 * only one with a hole in it (Nordland was never mapped), and that is handled
 * where it belongs — a topo base under it, in `resolveStack`.
 *
 * Two pieces of state rather than one. `backgroundLayerAtom` is what is on
 * the map, `standardVariantAtom` is what Standard *means* — they agree
 * whenever Standard is the ground, and diverge on purpose while you are on
 * another one, so pressing 1 comes back to the map you left instead of
 * resetting to topo.
 *
 * Mount once, from RibbonGlobalRow.
 */
export const useStandardControls = () => {
  const [backgroundLayer, setBackgroundLayer] = useAtom(backgroundLayerAtom);
  const [variant, setVariant] = useAtom(standardVariantAtom);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isStandardBackground = isStandardVariant(backgroundLayer);
  // What the strip should name. The background when it is one of ours, since
  // that is what the eye is reading; the remembered pick otherwise.
  const active: StandardVariant = isStandardBackground
    ? backgroundLayer
    : variant;

  const select = (next: StandardVariant) => {
    setVariant(next);
    setBackgroundLayer(next);
  };

  // Clicking a row picks *and* dismisses; W/S below picks without closing, so
  // the selection can be walked down an open list. Same split as the other
  // two pulldowns.
  const activate = (next: StandardVariant) => {
    select(next);
    setPickerOpen(false);
  };

  // Called by useGroundMode when Standard stops being the ground on screen.
  // Nothing on the map depends on the pulldown being open the way LiDAR's
  // footprints do, but an unmounted popover never fires its own
  // open-change callback, so it would come back open.
  const standDown = useCallback(() => setPickerOpen(false), []);

  // W/S walks the five in the order they are listed, which puts the three
  // modern renderings of the same ground next to each other and amtskart at
  // the far end — one press from topo in the other direction.
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
    standDown,
    active,
    pickerOpen,
    setPickerOpen,
    activate,
    // Entering the mode from row 1 or the digit 1. Not a pick, so it leaves
    // the remembered variant alone and simply puts it back on the map.
    enterStandard: () => {
      if (!isStandardBackground) setBackgroundLayer(variant);
    },
  };
};

export type StandardControls = ReturnType<typeof useStandardControls>;
