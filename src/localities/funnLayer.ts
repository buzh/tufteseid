import type { FeatureCollection } from 'geojson';
import { getDefaultStore, useAtomValue, useSetAtom } from 'jotai';
import { Feature, MapBrowserEvent } from 'ol';
import BaseEvent from 'ol/events/Event';
import { GeoJSON } from 'ol/format';
import VectorLayer from 'ol/layer/Vector';
import type Map from 'ol/Map';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import CircleStyle from 'ol/style/Circle';
import { useEffect } from 'react';
import {
  listLocalityFinds,
  LocalityFindRecord,
  subscribeLocalityFinds,
} from '../api/localityFinds';
import { getStyleFromProperties } from '../draw/featureStyle';
import { mapAtom } from '../map/atoms';
import {
  activeLocalityAtom,
  hoveredFunnIdAtom,
  selectedFunnIdAtom,
} from './atoms';

// Renders the funn of the OPEN lokalitet only. Features keep the style
// they were drawn with (round-tripped through geometry properties by
// serializeDrawLayer); this default is the fallback for features that
// carry none.
export const FUNN_ID_PROPERTY = '__funnId';
export const FUNN_LAYER_ID = 'funnLayer';

// Cased, barely filled. The relief under a funn is the evidence for it, so
// the shape marks the ground rather than covering it; the white underline is
// what keeps an orange stroke readable on both dark hillshade and bright
// ortofoto without having to shout.
const defaultFunnStyle = [
  new Style({
    stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.9)', width: 5 }),
  }),
  new Style({
    stroke: new Stroke({ color: '#FF6A00', width: 2.5 }),
    fill: new Fill({ color: 'rgba(255, 106, 0, 0.12)' }),
    image: new CircleStyle({
      radius: 7,
      fill: new Fill({ color: '#FF6A00' }),
      stroke: new Stroke({ color: '#ffffff', width: 2 }),
    }),
  }),
];

// A style with nothing in it draws nothing — how a funn is kept off the map
// while the draw layer is holding its shapes.
const INVISIBLE = new Style(undefined);

// The funn currently being drawn, if any. It has to stay hidden across
// re-hydration, not just once: every autosaved geometry patch comes back as a
// realtime update, which rebuilds the record's features from scratch and would
// otherwise put the persisted copy back underneath the one on the draw layer.
let hiddenFunnId: string | null = null;

const geoJson = new GeoJSON();

// PB json fields arrive parsed in REST responses but have shipped as
// strings over realtime SSE — cope with both.
const asFeatureCollection = (raw: unknown): FeatureCollection | null => {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as FeatureCollection;
    } catch (e) {
      console.warn('[funnLayer] geometry string not parseable', e);
      return null;
    }
  }
  return raw as FeatureCollection;
};

const hydrateFeatures = (
  rec: LocalityFindRecord,
  targetProjection: string,
): Feature[] => {
  const fc = asFeatureCollection(rec.geometry);
  if (!fc || !Array.isArray(fc.features)) {
    console.warn(`[funnLayer] funn "${rec.id}" has no readable geometry`);
    return [];
  }
  let features: Feature[];
  try {
    features = geoJson.readFeatures(fc, {
      dataProjection: 'EPSG:4326',
      featureProjection: targetProjection,
    }) as Feature[];
  } catch (e) {
    console.warn(`[funnLayer] readFeatures threw for "${rec.id}"`, e);
    return [];
  }
  for (const f of features) {
    f.set(FUNN_ID_PROPERTY, rec.id);
    if (rec.id === hiddenFunnId) {
      f.setStyle(INVISIBLE);
      continue;
    }
    let styled = getStyleFromProperties(f.getProperties());
    // Icon points were drawn with a transparent hit-area style plus a DOM
    // overlay; the round-tripped Style has no image, which would render
    // an invisible point here. Fall back to the visible default instead.
    if (
      styled &&
      f.getGeometry()?.getType() === 'Point' &&
      !styled.getImage() &&
      !styled.getText()
    ) {
      styled = null;
    }
    f.setStyle(styled ?? defaultFunnStyle);
  }
  return features;
};

export const getFunnLayer = (): VectorLayer | null => {
  const map = getDefaultStore().get(mapAtom);
  const layer = map
    .getLayers()
    .getArray()
    .find((l) => l.get('id') === FUNN_LAYER_ID);
  return (layer as VectorLayer | undefined) ?? null;
};

const removeById = (source: VectorSource, funnId: string) => {
  const doomed = source
    .getFeatures()
    .filter((f) => f.get(FUNN_ID_PROPERTY) === funnId);
  for (const f of doomed) source.removeFeature(f);
};

export const upsertFunnOnLayer = (rec: LocalityFindRecord) => {
  const source = getFunnLayer()?.getSource();
  if (!source) return;
  const map = getDefaultStore().get(mapAtom);
  const projection = map.getView().getProjection().getCode();
  removeById(source, rec.id);
  source.addFeatures(hydrateFeatures(rec, projection));
};

export const removeFunnFromLayer = (id: string) => {
  const source = getFunnLayer()?.getSource();
  if (source) removeById(source, id);
};

// Hide a funn while its geometry is being drawn on the draw layer, so the
// persisted copy doesn't double-render underneath. Pass null to lift it, then
// re-upsert the record to draw the version that was just saved.
export const hideFunnOnLayer = (id: string | null) => {
  hiddenFunnId = id;
  const source = getFunnLayer()?.getSource();
  if (!source || id == null) return;
  for (const f of source.getFeatures()) {
    if (f.get(FUNN_ID_PROPERTY) === id) f.setStyle(INVISIBLE);
  }
};

// Union extent of a funn's rendered features, in map coordinates — for
// zoom-to-funn in the workspace. Null when nothing is on the layer.
export const getFunnExtentOnLayer = (
  funnId: string,
): [number, number, number, number] | null => {
  const source = getFunnLayer()?.getSource();
  if (!source) return null;
  const features = source
    .getFeatures()
    .filter((f) => f.get(FUNN_ID_PROPERTY) === funnId);
  if (features.length === 0) return null;
  let extent: number[] | null = null;
  for (const f of features) {
    const g = f.getGeometry();
    if (!g) continue;
    const e = g.getExtent();
    extent = extent
      ? [
          Math.min(extent[0], e[0]),
          Math.min(extent[1], e[1]),
          Math.max(extent[2], e[2]),
          Math.max(extent[3], e[3]),
        ]
      : [...e];
  }
  return extent as [number, number, number, number] | null;
};

// Mount from useMapSideEffects. Follows the open lokalitet: hydrates its
// funn, keeps them synced via realtime, empties when the workspace closes.
export const useFunnLayer = () => {
  const map = useAtomValue(mapAtom);
  const activeLocality = useAtomValue(activeLocalityAtom);
  const localityId = activeLocality?.id ?? null;

  useEffect(() => {
    let layer = map
      .getLayers()
      .getArray()
      .find((l) => l.get('id') === FUNN_LAYER_ID) as VectorLayer | undefined;

    if (!layer) {
      layer = new VectorLayer({
        source: new VectorSource(),
        zIndex: 5,
        properties: { id: FUNN_LAYER_ID },
      });
      map.addLayer(layer);
    }

    const source = layer.getSource()!;
    source.clear();
    if (!localityId) return;

    const projection = map.getView().getProjection().getCode();
    let cancelled = false;

    listLocalityFinds(localityId)
      .then((records) => {
        if (cancelled) return;
        for (const rec of records) {
          source.addFeatures(hydrateFeatures(rec, projection));
        }
      })
      .catch((e) => {
        console.warn('[funnLayer] initial load failed', e);
      });

    const unsub = subscribeLocalityFinds((action, rec) => {
      if (rec.locality !== localityId) return;
      if (action === 'delete') {
        removeById(source, rec.id);
      } else {
        removeById(source, rec.id);
        source.addFeatures(hydrateFeatures(rec, projection));
      }
    });

    return () => {
      cancelled = true;
      unsub();
      source.clear();
    };
  }, [map, localityId]);
};

const funnIdAtPixel = (map: Map, pixel: [number, number]): string | null => {
  let hitId: string | null = null;
  map.forEachFeatureAtPixel(
    pixel,
    (feature, layer) => {
      if (layer?.get('id') !== FUNN_LAYER_ID) return undefined;
      const id = feature.get(FUNN_ID_PROPERTY) as string | undefined;
      if (id) {
        hitId = id;
        return true;
      }
      return undefined;
    },
    // A drawn line is a couple of pixels wide; without slack the only way
    // to hit one is to be exactly on it.
    { hitTolerance: 6 },
  );
  return hitId;
};

// The other half of the pointer link the list already had: hovering or
// clicking a funn *on the map* selects it in the dock, so the two views of
// the same set stay pointed at the same thing whichever one you touch.
//
// Mount from useMapSideEffects, next to useFunnLayer. Only the open
// lokalitet's funn are on the layer, so this is inert without one.
export const useFunnPointer = () => {
  const map = useAtomValue(mapAtom);
  const activeLocality = useAtomValue(activeLocalityAtom);
  const setSelected = useSetAtom(selectedFunnIdAtom);
  const setHovered = useSetAtom(hoveredFunnIdAtom);
  const localityId = activeLocality?.id ?? null;

  useEffect(() => {
    if (!localityId) return;

    const onClick = (e: Event | BaseEvent) => {
      if (!(e instanceof MapBrowserEvent)) return;
      const id = funnIdAtPixel(map, e.pixel as [number, number]);
      // Clicking past the funn is not "deselect": the click may well be
      // aimed at the background, and losing the selection every time you
      // pan-nudge the map would make the list's highlight useless.
      if (id) setSelected(id);
    };

    // Written through a local rather than read back off the store: this
    // fires on every mouse move over the map, and only the transitions
    // are worth a jotai write.
    let last: string | null = null;
    const onMove = (e: Event | BaseEvent) => {
      if (!(e instanceof MapBrowserEvent) || e.dragging) return;
      const id = funnIdAtPixel(map, e.pixel as [number, number]);
      if (id === last) return;
      last = id;
      setHovered(id);
    };

    map.on('singleclick', onClick);
    map.on('pointermove', onMove);
    return () => {
      map.un('singleclick', onClick);
      map.un('pointermove', onMove);
      setHovered(null);
    };
  }, [map, localityId, setSelected, setHovered]);
};
