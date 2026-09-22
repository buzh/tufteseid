// Placing the pin by hand: drag it anywhere on the map. Live only while the
// draft is in its `pin` stage, which is the stage a draft opens in and the one
// `Endre` returns it to.
//
// The same shape as `terrain/windowAdjust.ts` and for the same reasons: the
// draft atom is the only copy of the position, the geometry on the map is
// redrawn from it through a store subscription rather than a React dependency,
// and nothing expensive listens while the hand is down. What is different is
// that there is no cost to hold off — a pin is two numbers, so unlike the
// terrain rectangle there is no second atom saying "not yet".
//
// The whole pin is the handle, not a corner of it. A reader dragging a marker
// aims at the marker, and a hit test that only answered on the point would mean
// grabbing the tip of a pin whose head is what is drawn.

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
import { spotDraftAtom } from './atoms';
import { PIN_Z_INDEX, draftPinStyle } from './pinStyle';

/** How near the pin counts as taking hold of it, in pixels around its anchor. */
const GRAB_PX = 18;

/**
 * Mount once, from the spot controller. Adds nothing to the map unless a draft
 * is in its pin stage, so a draft whose author has moved on to drawing carries
 * no interaction and the plain pin (`spotLayer.ts`) is all that is drawn.
 */
export const useSpotPinAdjust = () => {
  const map = useAtomValue(mapAtom);
  const draft = useAtomValue(spotDraftAtom);
  const store = useStore();
  const live = draft?.stage === 'pin';

  useEffect(() => {
    if (!live) return;
    const view = map.getView().getProjection().getCode();
    const viewport = map.getViewport();

    /** Where the pin stands, in view coordinates. Null once the reader has put
     *  the draft down — the interaction can outlive one pointer event. */
    const positionNow = () => {
      const current = store.get(spotDraftAtom);
      if (!current) return null;
      return transform(current.point, 'EPSG:4326', view);
    };

    const pin = new Feature();
    const source = new VectorSource({ wrapX: false, features: [pin] });
    const layer = new VectorLayer({
      zIndex: PIN_Z_INDEX,
      source,
      style: draftPinStyle,
      properties: { id: 'spotPinAdjustLayer' },
    });

    const redraw = () => {
      const position = positionNow();
      if (position) pin.setGeometry(new Point(position));
    };

    const overPin = (event: MapBrowserEvent): boolean => {
      const position = positionNow();
      if (!position) return false;
      const pixel = map.getPixelFromCoordinate(position);
      if (!pixel) return false;
      return (
        Math.hypot(pixel[0] - event.pixel[0], pixel[1] - event.pixel[1]) <=
        GRAB_PX
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
      // The pin goes where the pointer is rather than following a grab offset:
      // the point being placed is the one under the cursor, and a pin that kept
      // the offset it was grabbed with would settle a few metres off what the
      // reader aimed at.
      const [lon, lat] = transform(event.coordinate, view, 'EPSG:4326');
      store.set(spotDraftAtom, { ...current, point: [lon, lat] });
    };

    const handleUpEvent = (): boolean => {
      dragging = false;
      return false;
    };

    const handleMoveEvent = (event: MapBrowserEvent) => {
      viewport.style.cursor = overPin(event) ? 'move' : '';
    };

    const interaction = new PointerInteraction({
      handleDownEvent,
      handleDragEvent,
      handleUpEvent,
      handleMoveEvent,
    });

    redraw();
    map.addLayer(layer);
    map.addInteraction(interaction);
    // Imperative rather than a React dependency: the drag writes the draft on
    // every frame, and rebuilding the layer and the interaction sixty times a
    // second to follow it would be the one expensive thing in here.
    const unsubscribe = store.sub(spotDraftAtom, redraw);

    return () => {
      unsubscribe();
      map.removeInteraction(interaction);
      map.removeLayer(layer);
      source.dispose();
      viewport.style.cursor = '';
    };
  }, [map, live, store]);
};
