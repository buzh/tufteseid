// The Kart arm's controller. One axis — which cartography — and two pieces of
// state on purpose.
//
// `backgroundLayerAtom` is what is on the map; `kartVariantAtom` is what Kart
// *means*. They diverge the moment another ground is up, and that divergence is
// the point: coming back to Kart from LiDAR returns to the map you left rather
// than to topo. Nothing else in here remembers anything, so there is no reason
// to mount it more than once — but nothing breaks if a second host does, since
// both atoms are the `.focused` facade of a `halved()` pair and neither is
// written by an effect.

import { useAtom } from 'jotai';
import { backgroundLayerAtom } from '../map/layers/config/backgroundLayers/atoms';
import {
  isKartVariant,
  kartVariantAtom,
  type KartVariant,
} from '../map/layers/config/backgroundLayers/kartVariants';

export const useKartControls = () => {
  const [backgroundLayer, setBackgroundLayer] = useAtom(backgroundLayerAtom);
  const [variant, setVariant] = useAtom(kartVariantAtom);

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
