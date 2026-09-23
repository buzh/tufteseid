// The saved spots on the map, and the click that opens one.
//
// What is drawn depends on who is looking, and that is deliberate. Signed in,
// the layer draws the list: your own spots and every public one, which is the
// index the record is for. Signed out, there is no list and it draws only the
// single record a short link resolved — a visitor who followed `/l/K7M2QX`
// came for that spot, and turning the map into a gazetteer of everybody's
// public pins for anyone who loads the page is a different product with
// different consent.
//
// The list itself is `spotRecords.ts`, which the band's index reads too. This
// module draws what is there and asks for nothing.

import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { Feature } from 'ol';
import type { FeatureLike } from 'ol/Feature';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import { transform } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { useEffect, useMemo } from 'react';

import type { SpotRecord } from '../api/spots';
import { mapAtom } from '../map/atoms';
import { activeSpotAtom, spotDraftAtom, spotPlacingAtom } from './atoms';
import { SPOT_LAYER_ID, SPOT_RECORD_KEY, spotAtPixel } from './hitTest';
import { PIN_Z_INDEX, spotStyle } from './pinStyle';
import { spotRecordsAtom } from './spotRecords';

const draw = (source: VectorSource, view: string, records: SpotRecord[]) => {
  source.clear();
  source.addFeatures(
    records.map((record) => {
      const feature = new Feature({
        geometry: new Point(transform(record.point, 'EPSG:4326', view)),
      });
      feature.set(SPOT_RECORD_KEY, record);
      return feature;
    }),
  );
};

export const useSpotLayer = () => {
  const map = useAtomValue(mapAtom);
  const records = useAtomValue(spotRecordsAtom);
  const active = useAtomValue(activeSpotAtom);
  const draft = useAtomValue(spotDraftAtom);
  const placing = useAtomValue(spotPlacingAtom);
  const setActive = useSetAtom(activeSpotAtom);
  const store = useStore();

  const source = useMemo(() => new VectorSource({ wrapX: false }), []);

  // The layer outlives every list: rebuilding it on a sign-in would take the
  // pins off the map and put them back.
  useEffect(() => {
    /** The record being edited, whose pin `pinAdjust.ts` is drawing instead —
     *  otherwise it stands at its saved point while the draft's stands where
     *  the reader has dragged it, and the spot has two pins. */
    let hidden = store.get(spotDraftAtom)?.recordId ?? null;

    const layer = new VectorLayer({
      zIndex: PIN_Z_INDEX,
      source,
      style: (feature: FeatureLike) => {
        const record = feature.get(SPOT_RECORD_KEY) as SpotRecord;
        if (record.id === hidden) return undefined;
        const open = store.get(activeSpotAtom);
        return spotStyle(record.name, record.id === open?.id);
      },
      properties: { id: SPOT_LAYER_ID },
    });
    map.addLayer(layer);

    // Read out of the store and redrawn from a subscription rather than taken
    // as dependencies: the layer is built once and the style function is the
    // same object for its whole life, so a value closed over here would be the
    // one it was built with — null, at first render, for both of these.
    const unsubscribe = [
      store.sub(activeSpotAtom, () => layer.changed()),
      store.sub(spotDraftAtom, () => {
        // Only on the record, not on the draft: the pin drag writes that atom
        // on every frame and none of those frames change what is drawn here.
        const next = store.get(spotDraftAtom)?.recordId ?? null;
        if (next === hidden) return;
        hidden = next;
        layer.changed();
      }),
    ];

    return () => {
      unsubscribe.forEach((off) => off());
      map.removeLayer(layer);
    };
  }, [map, source, store]);

  // The list while there is one, and the followed link until there is: a guest
  // has no list at all, and a reader who arrived on `/l/K7M2QX` sees that pin
  // rather than a bare map while theirs are still coming. Null once the list
  // is up, so opening a spot does not rebuild every feature on the map —
  // which one is open is a style question, and the subscription above has it.
  const linkOnly = records ? null : active;
  useEffect(() => {
    const view = map.getView().getProjection().getCode();
    draw(source, view, records ?? (linkOnly ? [linkOnly] : []));
  }, [map, source, records, linkOnly]);

  // Opening one.
  useEffect(() => {
    const onClick = (event: MapBrowserEvent) => {
      // Deaf while a spot of the reader's own is being made: the same click is
      // what puts the new pin down (`pinPlace.ts`), and once it is down a click
      // that opened somebody else's spot would replace the box being typed in.
      if (draft || placing) return;
      const hit = spotAtPixel(map, event.pixel);
      if (hit) setActive(hit);
    };
    map.on('singleclick', onClick);
    return () => {
      map.un('singleclick', onClick);
    };
  }, [map, setActive, draft, placing]);
};
