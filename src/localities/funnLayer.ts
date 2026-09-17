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
import { mapAtom } from '../map/atoms';
import {
  activeLocalityAtom,
  hoveredFunnIdAtom,
  selectedFunnIdAtom,
} from './atoms';

// The open lokalitet's funn, all in one style: a funn is geometry, and how it
// looks is this layer's decision rather than the record's.
export const FUNN_ID_PROPERTY = '__funnId';
export const FUNN_LAYER_ID = 'funnLayer';

// Barely filled: the relief under a funn is the evidence for it. The white
// casing keeps the orange readable on hillshade and ortofoto alike.
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

const INVISIBLE = new Style(undefined);

// The funn under the pen. Module level so it survives re-hydration: every
// autosaved patch returns as a realtime update that rebuilds the features.
let hiddenFunnId: string | null = null;

// Switched off by hand in `[Funn ▾]`. Kept separate from the pen's hide so a
// resumed draft cannot clear a switch, nor a switch outlive the pen.
let switchedOffFunnIds: ReadonlySet<string> = new Set<string>();

const styleFor = (funnId: string) =>
  funnId === hiddenFunnId || switchedOffFunnIds.has(funnId)
    ? INVISIBLE
    : defaultFunnStyle;

/** For the halo, which clones the shape. */
export const isFunnOnMap = (funnId: string) =>
  funnId !== hiddenFunnId && !switchedOffFunnIds.has(funnId);

/** Restyles in place, so features, subscriptions and selection survive. */
export const setSwitchedOffFunn = (ids: ReadonlySet<string>) => {
  switchedOffFunnIds = ids;
  const source = getFunnLayer()?.getSource();
  if (!source) return;
  for (const f of source.getFeatures()) {
    const id = f.get(FUNN_ID_PROPERTY) as string | undefined;
    if (id) f.setStyle(styleFor(id));
  }
};

const geoJson = new GeoJSON();

// PB json fields arrive parsed over REST but as strings over realtime SSE.
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
    f.setStyle(styleFor(rec.id));
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

// Hide while the geometry is on the draw layer, so the persisted copy does not
// double-render under it. Null lifts it; re-upsert to draw what was saved.
export const hideFunnOnLayer = (id: string | null) => {
  hiddenFunnId = id;
  const source = getFunnLayer()?.getSource();
  if (!source || id == null) return;
  for (const f of source.getFeatures()) {
    if (f.get(FUNN_ID_PROPERTY) === id) f.setStyle(styleFor(id));
  }
};

// Union extent in map coordinates, or null when nothing is on the layer.
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

// Re-hydrate, discarding what was pushed on by hand: the edit transaction
// buffers funn under temporary ids, and both committing and cancelling leave
// shapes on the layer that are no longer true.
let reloadFunnLayer: (() => void) | null = null;
export const refreshFunnLayer = () => reloadFunnLayer?.();

// Mount from useMapSideEffects; follows the open lokalitet over realtime.
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

    // `refresh` can start a second load while the first is still in flight.
    let seq = 0;
    const load = () => {
      const mine = ++seq;
      listLocalityFinds(localityId)
        .then((records) => {
          if (cancelled || seq !== mine) return;
          source.clear();
          for (const rec of records) {
            source.addFeatures(hydrateFeatures(rec, projection));
          }
        })
        .catch((e) => {
          console.warn('[funnLayer] load failed', e);
        });
    };
    load();
    reloadFunnLayer = load;

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
      if (reloadFunnLayer === load) reloadFunnLayer = null;
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
    { hitTolerance: 6 },
  );
  return hitId;
};

// Hover and click select, so the map, `[Funn ▾]` and the callout agree.
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
      // Clicking past a funn is not "deselect".
      if (id) setSelected(id);
    };

    // A local rather than the store: only the transitions are worth a write.
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
