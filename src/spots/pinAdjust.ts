import { useAtomValue, useStore } from 'jotai';
import { Feature } from 'ol';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import Point from 'ol/geom/Point';
import PointerInteraction from 'ol/interaction/Pointer';
import VectorLayer from 'ol/layer/Vector';
import { transform } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { useEffect } from 'react';

import { mapAtom } from '../map/atoms';
import { cursorLease } from '../map/cursorLease';
import { spotDraftAtom } from './atoms';
import { PIN_Z_INDEX, draftPinStyle, withinDraftPin } from './pinStyle';

type Store = ReturnType<typeof useStore>;

/** The pin's position in view coordinates, or null: an interaction can
 *  outlive the draft it was mounted for. */
const positionIn = (store: Store, view: string) => {
  const current = store.get(spotDraftAtom);
  if (!current) return null;
  return transform(current.point, 'EPSG:4326', view);
};

export const useSpotPinAdjust = () => {
  const map = useAtomValue(mapAtom);
  const draft = useAtomValue(spotDraftAtom);
  const store = useStore();
  const open = draft !== null;
  const placing = draft?.stage === 'pin';

  // The pin is drawn for the whole draft; the drag interaction below runs only
  // in the `pin` stage, since the sketch canvas covers the map.
  useEffect(() => {
    if (!open) return;
    const view = map.getView().getProjection().getCode();

    const pin = new Feature();
    const source = new VectorSource({ wrapX: false, features: [pin] });
    const layer = new VectorLayer({
      zIndex: PIN_Z_INDEX,
      source,
      style: draftPinStyle,
      properties: { id: 'spotPinAdjustLayer' },
    });

    const redraw = () => {
      const position = positionIn(store, view);
      if (position) pin.setGeometry(new Point(position));
    };

    redraw();
    map.addLayer(layer);
    // Subscribed rather than taken as a dependency: the drag writes the draft
    // every frame, and rebuilding the layer to follow it would be costly.
    const unsubscribe = store.sub(spotDraftAtom, redraw);

    return () => {
      unsubscribe();
      map.removeLayer(layer);
      source.dispose();
    };
  }, [map, open, store]);

  useEffect(() => {
    if (!placing) return;
    const view = map.getView().getProjection().getCode();
    const cursor = cursorLease(map.getViewport());

    const overPin = (event: MapBrowserEvent): boolean => {
      const position = positionIn(store, view);
      if (!position) return false;
      const pixel = map.getPixelFromCoordinate(position);
      if (!pixel) return false;
      return withinDraftPin(
        event.pixel[0] - pixel[0],
        event.pixel[1] - pixel[1],
      );
    };

    let dragging = false;

    const handleDownEvent = (event: MapBrowserEvent): boolean => {
      dragging = overPin(event);
      return dragging;
    };

    const handleDragEvent = (event: MapBrowserEvent) => {
      if (!dragging) return;
      const current = store.get(spotDraftAtom);
      if (!current) return;
      const [lon, lat] = transform(event.coordinate, view, 'EPSG:4326');
      store.set(spotDraftAtom, { ...current, point: [lon, lat] });
    };

    const handleUpEvent = (): boolean => {
      dragging = false;
      return false;
    };

    const handleMoveEvent = (event: MapBrowserEvent) => {
      cursor.set(overPin(event) ? 'move' : null);
    };

    const interaction = new PointerInteraction({
      handleDownEvent,
      handleDragEvent,
      handleUpEvent,
      handleMoveEvent,
    });

    map.addInteraction(interaction);

    return () => {
      map.removeInteraction(interaction);
      cursor.release();
    };
  }, [map, placing, store]);
};
