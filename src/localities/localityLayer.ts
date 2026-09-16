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

// The open lokalitet gets a heavier frame. Module-level because the
// style function can't reach jotai hooks; the workspace keeps it synced.
let highlightedLocalityId: string | null = null;

/*
 * How a lokalitet rectangle draws.
 *
 * The rectangle is a frame around the ground, never a tint over it: relief
 * shading is the thing being read, and an interior fill — even at 4 % — is
 * the loudest object on a grey hillshade. So: no visible fill, a thin dashed
 * line cased in white so it survives both dark relief and bright ortofoto,
 * and the name in a chip pinned to the top-left corner instead of a haloed
 * word across the middle of the view.
 *
 * It draws faint because the only question it has to answer is "somebody has
 * framed this ground, and it is called Storevike", and answering *that* at
 * full weight over the site you are actually reading is what "Skjul merker"
 * used to exist to undo. Fading is the better answer than a switch: it leaves
 * the rectangle clickable, so the way to open one is still to press it.
 *
 * And the open one draws no line at all — see `styleFor`.
 */
const FRAME_FAINT = 'rgba(255, 106, 0, 0.45)';
const CASING_FAINT = 'rgba(255, 255, 255, 0.4)';

const nameChip = (name: string, corner: number[]) =>
  new Style({
    geometry: new Point(corner),
    text: new Text({
      text: name,
      font: '500 12px sans-serif',
      // Faint, but not so faint it stops being readable over a bright
      // ortofoto — the chip is the only thing that says *which* lokalitet
      // the rectangle you are about to click is.
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

/*
 * Not decoration: OL hit-detects a polygon's interior by re-executing its
 * fill and testing the alpha byte, so dropping the fill entirely would make a
 * rectangle clickable only within a few pixels of its edge — and clicking one
 * is how you open it. 1 % white is invisible over both hillshade and ortofoto
 * and still rounds to alpha > 0.
 */
const hitFill = new Style({
  fill: new Fill({ color: 'rgba(255, 255, 255, 0.01)' }),
});

const styleFor = (feature: FeatureLike): Style[] => {
  const extent = feature.getGeometry()?.getExtent();
  if (!extent) return [];
  const name = (feature.get('name') as string) ?? '';

  /*
   * **The open lokalitet draws nothing at all** — no frame, no casing, no
   * corner brackets, no name chip.
   *
   * It used to draw at full weight, on the argument that it is the boundary
   * of what you are working in. But a `?lok=` view is already about one
   * rectangle and says so everywhere: the row carries its name and code, the
   * map is sitting on its extent, and every ground, View and sketch is
   * clipped to it. Nothing is left for the line to disambiguate — while it
   * *is* a bright orange border laid across the relief the lokalitet exists
   * to let you read, at the one moment the reading matters most, and worst
   * exactly at the edges, where a mound running out of the rectangle has to
   * be seen running out of it.
   *
   * Only the paint goes. The feature, the hit fill and everything built on
   * them stay, so clicking the ground still resolves to this lokalitet and
   * "Juster området" still hides a rectangle and hands it back
   * (`hideLocalityOnLayer`, which suppresses the fill too, so the handles get
   * the clicks).
   */
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

// Mount from useMapSideEffects. The *register* is behind sign-in: signed
// out, we never list, so the map is not an index of everybody's public
// rectangles. The one exception is the lokalitet a guest was actually sent
// to — a shared link opens for anybody now (shareLink.ts), and the rectangle
// is the lokalitet, so arriving at one and seeing no rectangle would be
// arriving nowhere.
export const useLocalitiesLayer = () => {
  const map = useAtomValue(mapAtom);
  const user = useAtomValue(currentUserAtom);
  const active = useAtomValue(activeLocalityAtom);
  // Signed in, the list and the subscription already carry whatever is open,
  // so re-running on every open would refetch the register for nothing.
  // Signed out it is the entire content of the layer.
  const guestLocality = user ? null : active;

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

    const projection = map.getView().getProjection().getCode();

    if (!user) {
      // Just the one, straight off the record the deep link already
      // resolved — no list, and no realtime either: a guest is reading a
      // rectangle, not watching a register.
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
      // Deaf while a rectangle is being placed. The placement covers the same
      // ground these rectangles are drawn on, so a drag that ends over a
      // neighbouring lokalitet would otherwise open it out from under the
      // session — and opening one closes the placement, taking the rectangle
      // with it. Read from the store rather than through the hook: this
      // listener is registered once and must see the flag as it is at click
      // time, not as it was when the effect last ran.
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
