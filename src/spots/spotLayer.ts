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

  useEffect(() => {
    /** The record being edited, whose pin `pinAdjust.ts` draws instead. */
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

    // The style function is built once and lives as long as the layer, so
    // anything closed over here would stay at its first-render value. Read
    // from the store and redraw off a subscription instead.
    const unsubscribe = [
      store.sub(activeSpotAtom, () => layer.changed()),
      store.sub(spotDraftAtom, () => {
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

  // The list where there is one, the followed link until then. Null once the
  // list is up, so opening a spot does not rebuild every feature.
  const linkOnly = records ? null : active;
  useEffect(() => {
    const view = map.getView().getProjection().getCode();
    draw(source, view, records ?? (linkOnly ? [linkOnly] : []));
  }, [map, source, records, linkOnly]);

  useEffect(() => {
    const onClick = (event: MapBrowserEvent) => {
      // Deaf while drafting: the same click places the new pin (`pinPlace.ts`).
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
