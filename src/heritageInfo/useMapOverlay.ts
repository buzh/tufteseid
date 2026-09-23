// Hands back the element the `Overlay` positions, for a portal: React must not
// own a node OpenLayers writes `style.transform` onto. The element is
// `pointer-events: none`; content opts back in, or the overlay's box swallows
// drags over map it is not covering.

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
  // Read once: rebuilding the overlay would detach the portal under React.
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

  // `undefined` hides an Overlay: OpenLayers sets `display: none` and leaves
  // the element in the DOM.
  useEffect(() => {
    overlayRef.current?.setPosition(position);
  }, [position]);

  return element;
};
