// Placing a new spot: the pin rides the cursor, and a click sticks it in.
//
// This is the gesture before there is a draft. `pinAdjust.ts` is the one after
// — the same pin, on the map instead of on the pointer, draggable while the
// box beside it is being written. The two are never mounted at once
// (`spotPlacingAtom`), so there is only ever one pin answering the hand.
//
// The system cursor is taken away while this runs and the drawn pin stands in
// for it, which is the point of the gesture: what the reader is aiming is the
// pin's tip, not an arrow that happens to be over the map. Until the pointer
// has moved once there is nowhere to draw it, so the viewport wears a crosshair
// for that one moment rather than nothing at all.
//
// Nothing here is expensive: a point geometry is rewritten on pointermove, and
// the feature has no label, no hit test and no source anybody else reads.

import { useAtomValue, useSetAtom } from 'jotai';
import { Feature } from 'ol';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import { transform } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { useEffect } from 'react';

import { mapAtom } from '../map/atoms';
import { cursorLease } from '../map/cursorLease';
import { placeSpotDraftAtom, spotPlacingAtom } from './atoms';
import { PIN_Z_INDEX, placingPinStyle } from './pinStyle';

/**
 * Mount once, from the spot controller. Adds nothing to the map unless the `+`
 * has been pressed.
 */
export const useSpotPlacement = () => {
  const map = useAtomValue(mapAtom);
  const placing = useAtomValue(spotPlacingAtom);
  const place = useSetAtom(placeSpotDraftAtom);
  const setPlacing = useSetAtom(spotPlacingAtom);

  useEffect(() => {
    if (!placing) return;
    const view = map.getView().getProjection().getCode();
    const viewport = map.getViewport();

    const pin = new Feature();
    const source = new VectorSource({ wrapX: false, features: [pin] });
    const layer = new VectorLayer({
      zIndex: PIN_Z_INDEX,
      source,
      style: placingPinStyle,
      properties: { id: 'spotPinPlaceLayer' },
    });
    map.addLayer(layer);

    const cursor = cursorLease(viewport);
    cursor.set('crosshair');

    /** Where the pointer last was, in pixels. The pin is drawn on the ground,
     *  so a map that moves under a hand holding still leaves it behind. */
    let at: number[] | null = null;

    const onMove = (event: MapBrowserEvent) => {
      // Not while panning: the map is moving under a hand that is reading it,
      // and the click that ends a drag places nothing either.
      if (event.dragging) return;
      cursor.set('none');
      at = event.pixel;
      pin.setGeometry(new Point(event.coordinate));
    };

    // Zooming in on the thing to be marked is half of aiming, and a wheel is
    // not a pointer move: the pin would sit at the coordinate it was last
    // dropped on until the hand twitched. Once, at the end of the movement,
    // rather than through it — following an animation frame by frame is a
    // redraw per frame for a pin nobody is looking at while the ground slides.
    const onMoveEnd = () => {
      if (!at) return;
      const coordinate = map.getCoordinateFromPixel(at);
      if (coordinate) pin.setGeometry(new Point(coordinate));
    };

    // Off the map, off the cursor. The pin is the pointer here, so leaving one
    // behind at the edge would be a pin nobody is holding.
    const onLeave = () => {
      at = null;
      pin.setGeometry(undefined);
      cursor.set('crosshair');
    };

    // `singleclick` rather than `click`: a double click zooms, and the first
    // half of it must not also drop a pin at a scale the reader is leaving.
    const onClick = (event: MapBrowserEvent) => {
      const [lon, lat] = transform(event.coordinate, view, 'EPSG:4326');
      place([lon, lat]);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPlacing(false);
    };

    map.on('pointermove', onMove);
    map.on('moveend', onMoveEnd);
    map.on('singleclick', onClick);
    viewport.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      map.un('pointermove', onMove);
      map.un('moveend', onMoveEnd);
      map.un('singleclick', onClick);
      viewport.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKeyDown);
      cursor.release();
      map.removeLayer(layer);
      source.dispose();
    };
  }, [map, placing, place, setPlacing]);
};
