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
import {
  activeSpotAtom,
  spotDraftAtom,
  spotPlacingAtom,
  unpinnedSpotIdAtom,
} from './atoms';
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
  const draft = useAtomValue(spotDraftAtom);
  const placing = useAtomValue(spotPlacingAtom);
  const setActive = useSetAtom(activeSpotAtom);
  const store = useStore();

  const source = useMemo(() => new VectorSource({ wrapX: false }), []);

  useEffect(() => {
    const layer = new VectorLayer({
      zIndex: PIN_Z_INDEX,
      source,
      style: (feature: FeatureLike) => {
        const record = feature.get(SPOT_RECORD_KEY) as SpotRecord;
        if (record.id === store.get(unpinnedSpotIdAtom)) return undefined;
        return spotStyle(record.name);
      },
      properties: { id: SPOT_LAYER_ID },
    });
    map.addLayer(layer);

    // The style function is built once and lives as long as the layer, so
    // anything closed over here would stick at its first-render value: read
    // from the store and redraw off a subscription instead.
    const unsubscribe = store.sub(unpinnedSpotIdAtom, () => layer.changed());

    return () => {
      unsubscribe();
      map.removeLayer(layer);
    };
  }, [map, source, store]);

  // A followed link is not drawn while the list is still out: the spot it opens
  // is the one spot with no pin, and nothing else is known yet.
  useEffect(() => {
    const view = map.getView().getProjection().getCode();
    draw(source, view, records ?? []);
  }, [map, source, records]);

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
