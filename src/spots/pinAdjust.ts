// The draft's pin: drawn for as long as there is a draft, and draggable while
// the draft is in its `pin` stage — the stage a draft opens in and the one
// `Endre` returns it to.
//
// Two effects, because the two have different lives. The pin stays on through
// the sketch stage: `spotLayer.ts` stands the saved record's own pin down while
// it is being edited, so this is the only thing marking where the spot is, and
// a new draft has no saved record to fall back on at all. The interaction does
// not, because the canvas covers the map and would swallow a drag aimed at it.
//
// The same shape as `terrain/windowAdjust.ts` and for the same reasons: the
// draft atom is the only copy of the position, the geometry on the map is
// redrawn from it through a store subscription rather than a React dependency,
// and nothing expensive listens while the hand is down. What is different is
// that there is no cost to hold off — a pin is two numbers, so unlike the
// terrain rectangle there is no second atom saying "not yet".
//
// The whole pin is the handle, not a corner of it. A reader dragging a marker
// aims at the head, which stands fifteen pixels above the coordinate the
// feature is at, so what counts as taking hold is the silhouette rather than a
// radius around the point (`withinDraftPin` in `pinStyle.ts`).

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

/** Where the pin stands, in view coordinates. Null once the reader has put the
 *  draft down — an interaction can outlive one pointer event. */
const positionIn = (store: Store, view: string) => {
  const current = store.get(spotDraftAtom);
  if (!current) return null;
  return transform(current.point, 'EPSG:4326', view);
};

/**
 * Mount once, from the spot controller. Adds nothing to the map unless a draft
 * is open.
 */
export const useSpotPinAdjust = () => {
  const map = useAtomValue(mapAtom);
  const draft = useAtomValue(spotDraftAtom);
  const store = useStore();
  const open = draft !== null;
  const placing = draft?.stage === 'pin';

  // The pin. Keeps the halo through the sketch stage, where it cannot be
  // grabbed: it still says which of the pins on the map is the one being
  // written, which is what the reader is drawing about.
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
    // Imperative rather than a React dependency: the drag writes the draft on
    // every frame, and rebuilding the layer to follow it would be the one
    // expensive thing in here.
    const unsubscribe = store.sub(spotDraftAtom, redraw);

    return () => {
      unsubscribe();
      map.removeLayer(layer);
      source.dispose();
    };
  }, [map, open, store]);

  // Taking hold of it.
  useEffect(() => {
    if (!placing) return;
    const view = map.getView().getProjection().getCode();
    const cursor = cursorLease(map.getViewport());

    const overPin = (event: MapBrowserEvent): boolean => {
      const position = positionIn(store, view);
      if (!position) return false;
      const pixel = map.getPixelFromCoordinate(position);
      if (!pixel) return false;
      return withinDraftPin(event.pixel[0] - pixel[0], event.pixel[1] - pixel[1]);
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
      // The tip goes where the pointer is rather than following a grab offset:
      // the point being placed is the one under the cursor, and a pin that kept
      // the offset it was grabbed with would settle a few metres off what the
      // reader aimed at. So a pin taken by the head snaps its tip under the
      // hand, which is where placing one put it in the first place
      // (`pinPlace.ts`).
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
