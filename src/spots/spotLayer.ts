import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { Feature } from 'ol';
import type { FeatureLike } from 'ol/Feature';
import type Map from 'ol/Map';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import { boundingExtent, getHeight, getWidth } from 'ol/extent';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import { transform } from 'ol/proj';
import ClusterSource from 'ol/source/Cluster';
import VectorSource from 'ol/source/Vector';
import { useEffect, useMemo } from 'react';

import type { SpotRecord } from '../api/spots';
import { mapAtom } from '../map/atoms';
import { placeInfoArmedAtom } from '../placeInfo/atoms';
import { drawnSketchSpotsAtom } from '../sketch/allSketches';
import {
  activeSpotAtom,
  spotDraftAtom,
  spotPlacingAtom,
  unpinnedSpotIdAtom,
} from './atoms';
import {
  clusterRecords,
  SPOT_LAYER_ID,
  SPOT_RECORD_KEY,
  spotsAtPixel,
} from './hitTest';
import {
  clusterStyle,
  LABEL_OFF_ZOOM,
  PIN_Z_INDEX,
  spotStyle,
} from './pinStyle';
import { spotRecordsAtom } from './spotRecords';

const CLUSTER_DISTANCE = 44;

/** Room left around a gathering the view was zoomed into. */
const FIT_PADDING_PX = 48;

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

const openHit = (
  map: Map,
  records: SpotRecord[],
  open: (record: SpotRecord) => void,
) => {
  const view = map.getView();
  const projection = view.getProjection();
  const extent = boundingExtent(
    records.map((record) => transform(record.point, 'EPSG:4326', projection)),
  );
  if (
    records.length === 1 ||
    (getWidth(extent) === 0 && getHeight(extent) === 0)
  ) {
    open(records[0]);
    return;
  }
  view.fit(extent, {
    padding: [FIT_PADDING_PX, FIT_PADDING_PX, FIT_PADDING_PX, FIT_PADDING_PX],
    duration: 300,
  });
};

export const useSpotLayer = () => {
  const map = useAtomValue(mapAtom);
  const records = useAtomValue(spotRecordsAtom);
  const draft = useAtomValue(spotDraftAtom);
  const placing = useAtomValue(spotPlacingAtom);
  const armed = useAtomValue(placeInfoArmedAtom);
  const setActive = useSetAtom(activeSpotAtom);
  const store = useStore();

  const source = useMemo(() => new VectorSource({ wrapX: false }), []);

  const clusters = useMemo(
    () =>
      new ClusterSource({
        source,
        distance: CLUSTER_DISTANCE,
        // Null drops the feature. The spot whose card or reader is open keeps
        // no pin, so it must not swell the count of a gathering either. Nor
        // does one whose drawing is on the shared layer: there the drawing is
        // the pin, and the reader zoomed in to read the strokes, not a plate
        // over them.
        geometryFunction: (feature) => {
          const record = feature.get(SPOT_RECORD_KEY) as SpotRecord;
          if (record.id === store.get(unpinnedSpotIdAtom)) return null;
          if (store.get(drawnSketchSpotsAtom).has(record.id)) return null;
          return feature.getGeometry() as Point;
        },
      }),
    [source, store],
  );

  useEffect(() => {
    const layer = new VectorLayer({
      zIndex: PIN_Z_INDEX,
      source: clusters,
      style: (feature: FeatureLike, resolution: number) => {
        const gathered = clusterRecords(feature);
        if (gathered.length > 1) return clusterStyle(gathered.length);
        const zoom = map.getView().getZoomForResolution(resolution) ?? 0;
        return spotStyle(gathered[0].name, zoom > LABEL_OFF_ZOOM);
      },
      properties: { id: SPOT_LAYER_ID },
    });
    map.addLayer(layer);


    const unsubscribe = store.sub(unpinnedSpotIdAtom, () => clusters.refresh());
    const unsubscribeDrawn = store.sub(drawnSketchSpotsAtom, () =>
      clusters.refresh(),
    );

    return () => {
      unsubscribe();
      unsubscribeDrawn();
      map.removeLayer(layer);
    };
  }, [map, clusters, store]);


  useEffect(() => {
    const view = map.getView();
    const apply = () => {
      const zoom = view.getZoom() ?? 0;
      clusters.setDistance(zoom >= view.getMaxZoom() ? 0 : CLUSTER_DISTANCE);
    };
    apply();
    view.on('change:resolution', apply);
    return () => {
      view.un('change:resolution', apply);
    };
  }, [map, clusters]);


  useEffect(() => {
    const view = map.getView().getProjection().getCode();
    draw(source, view, records ?? []);
  }, [map, source, records]);

  useEffect(() => {
    const onClick = (event: MapBrowserEvent) => {

      if (draft || placing || armed) return;
      const hit = spotsAtPixel(map, event.pixel);
      if (hit) openHit(map, hit, setActive);
    };
    map.on('singleclick', onClick);
    return () => {
      map.un('singleclick', onClick);
    };
  }, [map, setActive, draft, placing, armed]);
};
