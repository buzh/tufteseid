import { useAtomValue } from 'jotai';
import { Overlay } from 'ol';
import type { Coordinate } from 'ol/coordinate';
import type { Options } from 'ol/Overlay';
import { useEffect, useRef, useState } from 'react';
import { mapAtom } from './atoms';

export const useMapOverlay = (
  position: Coordinate | undefined,
  options: Omit<Options, 'element' | 'position'>,
): HTMLElement => {
  const map = useAtomValue(mapAtom);
  const overlayRef = useRef<Overlay | null>(null);
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

  useEffect(() => {
    overlayRef.current?.setPosition(position);
  }, [position]);

  return element;
};
