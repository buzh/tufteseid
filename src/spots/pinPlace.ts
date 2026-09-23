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

    /** Where the pointer last was, in pixels. */
    let at: number[] | null = null;

    const onMove = (event: MapBrowserEvent) => {
      if (event.dragging) return;
      cursor.set('none');
      at = event.pixel;
      pin.setGeometry(new Point(event.coordinate));
    };

    // The pin is drawn on the ground: a wheel zoom is no pointer move, so
    // re-place it from the last pixel once the movement ends.
    const onMoveEnd = () => {
      if (!at) return;
      const coordinate = map.getCoordinateFromPixel(at);
      if (coordinate) pin.setGeometry(new Point(coordinate));
    };

    const onLeave = () => {
      at = null;
      pin.setGeometry(undefined);
      cursor.set('crosshair');
    };

    // `singleclick`, not `click`: the first half of a double-click zoom must
    // not also drop a pin.
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
