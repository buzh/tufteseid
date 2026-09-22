// The saved spots on the map, and the click that opens one.
//
// What is drawn depends on who is looking, and that is deliberate. Signed in,
// the layer lists: your own spots and every public one, which is the index the
// record is for. Signed out, it lists nothing and draws only the single record
// a short link resolved — a visitor who followed `/l/K7M2QX` came for that
// spot, and turning the map into a gazetteer of everybody's public pins for
// anyone who loads the page is a different product with different consent.

import { useAtomValue, useSetAtom } from 'jotai';
import { Feature } from 'ol';
import type { FeatureLike } from 'ol/Feature';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import { transform } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { useEffect, useMemo } from 'react';

import { listSpots, subscribeSpots, type SpotRecord } from '../api/spots';
import { currentUserAtom } from '../auth/atoms';
import { mapAtom } from '../map/atoms';
import { activeSpotAtom, spotDraftAtom } from './atoms';
import { PIN_Z_INDEX, spotStyle } from './pinStyle';

const LAYER_ID = 'spotsLayer';
const RECORD_KEY = 'spotRecord';

/** How far off a pin a click still counts, in pixels. */
const HIT_TOLERANCE = 6;

export const useSpotLayer = () => {
  const map = useAtomValue(mapAtom);
  const user = useAtomValue(currentUserAtom);
  const active = useAtomValue(activeSpotAtom);
  const draft = useAtomValue(spotDraftAtom);
  const setActive = useSetAtom(activeSpotAtom);

  const source = useMemo(() => new VectorSource({ wrapX: false }), []);

  // The layer outlives every list: rebuilding it on a sign-in would take the
  // pins off the map and put them back.
  useEffect(() => {
    const layer = new VectorLayer({
      zIndex: PIN_Z_INDEX,
      source,
      style: (feature: FeatureLike) => {
        const record = feature.get(RECORD_KEY) as SpotRecord;
        return spotStyle(record.name, record.id === active?.id);
      },
      properties: { id: LAYER_ID },
    });
    map.addLayer(layer);
    return () => {
      map.removeLayer(layer);
    };
    // `active` is read inside the style function, which OL re-runs on every
    // render pass, so it is not a dependency: naming it here would rebuild the
    // layer every time a different spot was opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, source]);

  // Which records are on it.
  useEffect(() => {
    const view = map.getView().getProjection().getCode();

    const draw = (records: SpotRecord[]) => {
      source.clear();
      source.addFeatures(
        records.map((record) => {
          const feature = new Feature({
            geometry: new Point(transform(record.point, 'EPSG:4326', view)),
          });
          feature.set(RECORD_KEY, record);
          return feature;
        }),
      );
    };

    if (!user) {
      draw(active ? [active] : []);
      return;
    }

    let live = true;
    const records = new Map<string, SpotRecord>();

    listSpots()
      .then((list) => {
        if (!live) return;
        for (const record of list) records.set(record.id, record);
        draw([...records.values()]);
      })
      .catch((err) => console.warn('[spots] list failed', err));

    const unsubscribe = subscribeSpots((action, record) => {
      if (!live) return;
      if (action === 'delete') records.delete(record.id);
      else records.set(record.id, record);
      draw([...records.values()]);
    });

    return () => {
      live = false;
      unsubscribe();
    };
  }, [map, source, user, active]);

  // Opening one. Restricted to this layer rather than hit-testing the map,
  // so a click that lands on a Kulturminner feature is still the register's.
  useEffect(() => {
    const onClick = (event: MapBrowserEvent) => {
      // Deaf while a draft is open: the pin is being placed, and a click that
      // opened somebody else's spot mid-placement would replace the box the
      // reader is typing in.
      if (draft) return;
      const hit = map.forEachFeatureAtPixel(
        event.pixel,
        (feature) => feature.get(RECORD_KEY) as SpotRecord | undefined,
        {
          hitTolerance: HIT_TOLERANCE,
          layerFilter: (layer) => layer.get('id') === LAYER_ID,
        },
      );
      if (hit) setActive(hit);
    };
    map.on('singleclick', onClick);
    return () => {
      map.un('singleclick', onClick);
    };
  }, [map, setActive, draft]);
};
