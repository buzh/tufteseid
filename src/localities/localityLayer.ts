import { getDefaultStore, useAtomValue, useSetAtom } from 'jotai';
import { Feature, MapBrowserEvent } from 'ol';
import BaseEvent from 'ol/events/Event';
import type { FeatureLike } from 'ol/Feature';
import MultiLineString from 'ol/geom/MultiLineString';
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

export const LOCALITY_ID_PROPERTY = '__localityId';
export const LOCALITIES_LAYER_ID = 'localitiesLayer';

// The open lokalitet gets a heavier frame. Module-level because the
// style function can't reach jotai hooks; the workspace keeps it synced.
let highlightedLocalityId: string | null = null;

/*
 * How a lokalitet rectangle draws.
 *
 * The rectangle is a frame around the ground, never a tint over it: relief
 * shading is the thing being read, and an interior fill — even at 4 % — is
 * the loudest object on a grey hillshade. So: no fill at all, a thin line
 * cased in white so it survives both dark relief and bright ortofoto, corner
 * brackets to say "this one is open", and the name in a chip pinned to the
 * top-left corner instead of a haloed word across the middle of the view.
 *
 * Two strengths, and the gap between them is wide on purpose. The open
 * lokalitet is the boundary of what you are working in and draws at full
 * weight. Every *other* one draws faint — dashed, half-alpha, its name chip
 * barely there — because the only question it has to answer is "somebody has
 * framed this ground", and answering it at full weight over the site you are
 * actually reading is what "Skjul merker" used to exist to undo. Fading is
 * the better answer than a switch: it leaves the rectangle clickable, so the
 * way to open a neighbour is still to press it.
 */
const FRAME = '#FF6A00';
const CASING = 'rgba(255, 255, 255, 0.9)';
const FRAME_FAINT = 'rgba(255, 106, 0, 0.45)';
const CASING_FAINT = 'rgba(255, 255, 255, 0.4)';
// Bracket arms are a constant length on screen, not on the ground.
const BRACKET_PX = 18;

const cornerBrackets = (
  extent: number[],
  resolution: number,
): MultiLineString => {
  const [minX, minY, maxX, maxY] = extent;
  // Never longer than a third of a side, or a small rectangle turns into a
  // solid frame with a gap in the middle of each edge.
  const a = Math.min(
    BRACKET_PX * resolution,
    (maxX - minX) / 3,
    (maxY - minY) / 3,
  );
  return new MultiLineString([
    [
      [minX, minY + a],
      [minX, minY],
      [minX + a, minY],
    ],
    [
      [maxX - a, minY],
      [maxX, minY],
      [maxX, minY + a],
    ],
    [
      [maxX, maxY - a],
      [maxX, maxY],
      [maxX - a, maxY],
    ],
    [
      [minX + a, maxY],
      [minX, maxY],
      [minX, maxY - a],
    ],
  ]);
};

const nameChip = (name: string, corner: number[], highlighted: boolean) =>
  new Style({
    geometry: new Point(corner),
    text: new Text({
      text: name,
      font: `${highlighted ? 600 : 500} 12px sans-serif`,
      // Faint, but not so faint it stops being readable over a bright
      // ortofoto — the chip is the only thing that says *which* lokalitet
      // the rectangle you are about to click is.
      fill: new Fill({
        color: highlighted ? '#ffffff' : 'rgba(58, 24, 0, 0.65)',
      }),
      backgroundFill: new Fill({
        color: highlighted ? FRAME : 'rgba(255, 255, 255, 0.45)',
      }),
      padding: [2, 5, 2, 5],
      textAlign: 'left',
      textBaseline: 'bottom',
      offsetX: 2,
      offsetY: -4,
      overflow: true,
    }),
  });

const styleFor = (feature: FeatureLike, resolution: number): Style[] => {
  const extent = feature.getGeometry()?.getExtent();
  if (!extent) return [];
  const name = (feature.get('name') as string) ?? '';
  const highlighted =
    feature.get(LOCALITY_ID_PROPERTY) === highlightedLocalityId;

  const styles = [
    new Style({
      // Not decoration: OL hit-detects a polygon's interior by re-executing
      // its fill and testing the alpha byte, so dropping the fill entirely
      // would make a rectangle clickable only within a few pixels of its
      // edge — and clicking one is how you open it. 1 % white is invisible
      // over both hillshade and ortofoto and still rounds to alpha > 0.
      fill: new Fill({ color: 'rgba(255, 255, 255, 0.01)' }),
    }),
    new Style({
      stroke: new Stroke({
        color: highlighted ? CASING : CASING_FAINT,
        width: highlighted ? 4 : 2,
        lineDash: highlighted ? undefined : [7, 7],
      }),
    }),
    new Style({
      stroke: new Stroke({
        color: highlighted ? FRAME : FRAME_FAINT,
        width: highlighted ? 2 : 1,
        lineDash: highlighted ? undefined : [7, 7],
      }),
    }),
  ];

  if (highlighted) {
    styles.push(
      new Style({
        geometry: cornerBrackets(extent, resolution),
        stroke: new Stroke({ color: CASING, width: 6 }),
      }),
      new Style({
        geometry: cornerBrackets(extent, resolution),
        stroke: new Stroke({ color: FRAME, width: 3 }),
      }),
    );
  }

  if (name) styles.push(nameChip(name, [extent[0], extent[3]], highlighted));
  return styles;
};

// PB json fields arrive parsed in REST responses but have shipped as
// strings over realtime SSE — cope with both.
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

// Push a record straight onto the layer after create/update — realtime
// is best-effort and we already hold the record.
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

// Hide a rectangle while the adjust interaction shows its own editable
// copy on a temp layer. Restore by re-upserting the record.
export const hideLocalityOnLayer = (id: string) => {
  const source = getLocalitiesLayer()?.getSource();
  if (!source) return;
  for (const f of source.getFeatures()) {
    if (f.get(LOCALITY_ID_PROPERTY) === id) f.setStyle(new Style(undefined));
  }
};

// Mount from useMapSideEffects. Everything is behind sign-in: signed out,
// the layer stays empty and we never hit PB.
export const useLocalitiesLayer = () => {
  const map = useAtomValue(mapAtom);
  const user = useAtomValue(currentUserAtom);

  useEffect(() => {
    let layer = map
      .getLayers()
      .getArray()
      .find((l) => l.get('id') === LOCALITIES_LAYER_ID) as
      | VectorLayer
      | undefined;

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
    if (!user) return;

    const projection = map.getView().getProjection().getCode();
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
  }, [map, user?.id]);
};

// Click a rectangle (outside any workspace/tool) → open its workspace.
export const useLocalityClick = () => {
  const map = useAtomValue(mapAtom);
  const user = useAtomValue(currentUserAtom);
  const active = useAtomValue(activeLocalityAtom);
  const setActive = useSetAtom(activeLocalityAtom);

  useEffect(() => {
    if (!user) return;

    const onClick = (e: Event | BaseEvent) => {
      if (!(e instanceof MapBrowserEvent)) return;
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
