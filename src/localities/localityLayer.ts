import { getDefaultStore, useAtomValue, useSetAtom } from 'jotai';
import { Feature, MapBrowserEvent } from 'ol';
import BaseEvent from 'ol/events/Event';
import type { FeatureLike } from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import VectorLayer from 'ol/layer/Vector';
import { transformExtent } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style, Text } from 'ol/style';
import { useEffect } from 'react';
import {
  getLocality,
  listLocalities,
  LocalityBbox,
  LocalityRecord,
  subscribeLocalities,
} from '../api/localities';
import { currentUserAtom } from '../auth/atoms';
import { mapAtom } from '../map/atoms';
import { activeLocalityAtom } from './atoms';
import { localityPlacementAtom } from './placement';

export const LOCALITY_ID_PROPERTY = '__localityId';
export const LOCALITIES_LAYER_ID = 'localitiesLayer';

// Module level: the style function cannot reach jotai hooks.
let highlightedLocalityId: string | null = null;

// A frame around the ground, never a tint over it: a dashed line cased in
// white so it survives dark relief and bright ortofoto, plus a corner chip.
const FRAME_FAINT = 'rgba(255, 106, 0, 0.45)';
const CASING_FAINT = 'rgba(255, 255, 255, 0.4)';

const nameChip = (name: string, corner: number[]) =>
  new Style({
    geometry: new Point(corner),
    text: new Text({
      text: name,
      font: '500 12px sans-serif',
      fill: new Fill({ color: 'rgba(58, 24, 0, 0.65)' }),
      backgroundFill: new Fill({ color: 'rgba(255, 255, 255, 0.45)' }),
      padding: [2, 5, 2, 5],
      textAlign: 'left',
      textBaseline: 'bottom',
      offsetX: 2,
      offsetY: -4,
      overflow: true,
    }),
  });

// Required: OL hit-detects an interior by re-running the fill and testing the
// alpha byte, so with no fill only the edge is clickable. 1 % rounds to >0.
const hitFill = new Style({
  fill: new Fill({ color: 'rgba(255, 255, 255, 0.01)' }),
});

const styleFor = (feature: FeatureLike): Style[] => {
  const extent = feature.getGeometry()?.getExtent();
  if (!extent) return [];
  const name = (feature.get('name') as string) ?? '';

  // The open lokalitet draws no paint: its own edges are where a mound running
  // out of the rectangle has to stay readable. The hit fill stays.
  if (feature.get(LOCALITY_ID_PROPERTY) === highlightedLocalityId) {
    return [hitFill];
  }

  const styles = [
    hitFill,
    new Style({
      stroke: new Stroke({
        color: CASING_FAINT,
        width: 2,
        lineDash: [7, 7],
      }),
    }),
    new Style({
      stroke: new Stroke({
        color: FRAME_FAINT,
        width: 1,
        lineDash: [7, 7],
      }),
    }),
  ];

  if (name) styles.push(nameChip(name, [extent[0], extent[3]]));
  return styles;
};

// PB json fields arrive parsed over REST but as strings over realtime SSE.
const asBbox = (raw: unknown): LocalityBbox | null => {
  const value = typeof raw === 'string' ? safeParse(raw) : raw;
  if (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === 'number')
  ) {
    return value as LocalityBbox;
  }
  return null;
};

const safeParse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const hydrateFeature = (
  rec: LocalityRecord,
  targetProjection: string,
): Feature | null => {
  const bbox = asBbox(rec.bbox);
  if (!bbox) {
    console.warn(`[localityLayer] "${rec.id}" has no readable bbox`, rec.bbox);
    return null;
  }
  const extent = transformExtent(bbox, 'EPSG:4326', targetProjection);
  const feature = new Feature({ geometry: polygonFromExtent(extent) });
  feature.set(LOCALITY_ID_PROPERTY, rec.id);
  feature.set('name', rec.name);
  return feature;
};

export const getLocalitiesLayer = (): VectorLayer | null => {
  const map = getDefaultStore().get(mapAtom);
  const layer = map
    .getLayers()
    .getArray()
    .find((l) => l.get('id') === LOCALITIES_LAYER_ID);
  return (layer as VectorLayer | undefined) ?? null;
};

const removeById = (source: VectorSource, id: string) => {
  const doomed = source
    .getFeatures()
    .filter((f) => f.get(LOCALITY_ID_PROPERTY) === id);
  for (const f of doomed) source.removeFeature(f);
};

// Realtime is best-effort and the caller already holds the record.
export const upsertLocalityOnLayer = (rec: LocalityRecord) => {
  const layer = getLocalitiesLayer();
  const source = layer?.getSource();
  if (!source) return;
  const map = getDefaultStore().get(mapAtom);
  const projection = map.getView().getProjection().getCode();
  removeById(source, rec.id);
  const feature = hydrateFeature(rec, projection);
  if (feature) source.addFeature(feature);
};

export const removeLocalityFromLayer = (id: string) => {
  const source = getLocalitiesLayer()?.getSource();
  if (source) removeById(source, id);
};

export const setLocalityHighlight = (id: string | null) => {
  highlightedLocalityId = id;
  getLocalitiesLayer()?.changed();
};

// Hide while adjust shows an editable copy; restore by re-upserting.
export const hideLocalityOnLayer = (id: string) => {
  const source = getLocalitiesLayer()?.getSource();
  if (!source) return;
  for (const f of source.getFeatures()) {
    if (f.get(LOCALITY_ID_PROPERTY) === id) f.setStyle(new Style(undefined));
  }
};

// Mount from useMapSideEffects. Signed out we never list, so the map is not an
// index of everybody's public rectangles — only what a shared link resolved.
export const useLocalitiesLayer = () => {
  const map = useAtomValue(mapAtom);
  const user = useAtomValue(currentUserAtom);
  const active = useAtomValue(activeLocalityAtom);
  const guestLocality = user ? null : active;

  useEffect(() => {
    let layer = map
      .getLayers()
      .getArray()
      .find((l) => l.get('id') === LOCALITIES_LAYER_ID) as
      VectorLayer | undefined;

    if (!layer) {
      layer = new VectorLayer({
        source: new VectorSource(),
        zIndex: 4,
        style: styleFor,
        properties: { id: LOCALITIES_LAYER_ID },
      });
      map.addLayer(layer);
    }

    const source = layer.getSource()!;
    source.clear();

    const projection = map.getView().getProjection().getCode();

    if (!user) {
      // No list and no realtime: a guest reads a rectangle, not a register.
      if (guestLocality) {
        const feature = hydrateFeature(guestLocality, projection);
        if (feature) source.addFeature(feature);
      }
      return () => {
        source.clear();
      };
    }

    let cancelled = false;

    listLocalities()
      .then((records) => {
        if (cancelled) return;
        for (const rec of records) {
          const feature = hydrateFeature(rec, projection);
          if (feature) source.addFeature(feature);
        }
      })
      .catch((e) => {
        console.warn('[localityLayer] initial load failed', e);
      });

    const unsub = subscribeLocalities((action, rec) => {
      if (action === 'delete') {
        removeById(source, rec.id);
      } else {
        removeById(source, rec.id);
        const feature = hydrateFeature(rec, projection);
        if (feature) source.addFeature(feature);
      }
    });

    return () => {
      cancelled = true;
      unsub();
      source.clear();
    };
  }, [map, user?.id, guestLocality]);
};

export const useLocalityClick = () => {
  const map = useAtomValue(mapAtom);
  const user = useAtomValue(currentUserAtom);
  const active = useAtomValue(activeLocalityAtom);
  const setActive = useSetAtom(activeLocalityAtom);

  useEffect(() => {
    if (!user) return;

    const onClick = (e: Event | BaseEvent) => {
      if (!(e instanceof MapBrowserEvent)) return;
      // Deaf while a rectangle is being placed. Read from the store, not the
      // hook: this listener is registered once and must see the flag live.
      if (getDefaultStore().get(localityPlacementAtom)) return;
      let hitId: string | null = null;
      map.forEachFeatureAtPixel(
        e.pixel as [number, number],
        (feature, layer) => {
          if (layer?.get('id') !== LOCALITIES_LAYER_ID) return undefined;
          const id = feature.get(LOCALITY_ID_PROPERTY) as string | undefined;
          if (id) {
            hitId = id;
            return true;
          }
          return undefined;
        },
        { hitTolerance: 3 },
      );
      // Re-clicking the open lokalitet is a no-op; clicking another swaps.
      if (!hitId || hitId === active?.id) return;
      getLocality(hitId)
        .then((rec) => setActive(rec))
        .catch((err) =>
          console.warn('[localityLayer] open-on-click failed', err),
        );
    };

    map.on('singleclick', onClick);
    return () => {
      map.un('singleclick', onClick);
    };
  }, [map, user, active?.id, setActive]);
};
