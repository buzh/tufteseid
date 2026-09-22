// An OpenLayers `Overlay` is what pins a surface to a place on the ground
// rather than to a place on the screen: it moves with the map, so a card about a
// gravhaug stays over the gravhaug while the reader pans to see what is around
// it. This hands back the element it positions, for a portal — React must not
// own a node OpenLayers is writing `style.transform` onto.
//
// The element is `pointer-events: none` throughout, and whatever is rendered
// into it opts back in. Otherwise the overlay's own box — which is as wide as
// the card at its widest — would swallow drags over map the card is not
// covering.

import { useAtomValue } from 'jotai';
import { Overlay } from 'ol';
import type { Coordinate } from 'ol/coordinate';
import type { Options } from 'ol/Overlay';
import { useEffect, useRef, useState } from 'react';
import { mapAtom } from '../map/atoms';

export const useMapOverlay = (
  position: Coordinate | undefined,
  options: Omit<Options, 'element' | 'position'>,
): HTMLElement => {
  const map = useAtomValue(mapAtom);
  const overlayRef = useRef<Overlay | null>(null);
  // Read once: these describe the shape of the overlay, not its state, and
  // rebuilding one on every render would detach the portal under React.
  const optionsRef = useRef(options);

  const [element] = useState(() => {
    const el = document.createElement('div');
    el.style.pointerEvents = 'none';
    return el;
  });

  useEffect(() => {
    const overlay = new Overlay({ ...optionsRef.current, element });
    overlayRef.current = overlay;
    map.addOverlay(overlay);
    return () => {
      map.removeOverlay(overlay);
      overlayRef.current = null;
    };
  }, [map, element]);

  // `undefined` is how an Overlay is hidden; the element stays in the DOM and
  // OpenLayers sets `display: none` on it.
  useEffect(() => {
    overlayRef.current?.setPosition(position);
  }, [position]);

  return element;
};
