import { useAtomValue } from 'jotai';
import { Feature } from 'ol';
import type Map from 'ol/Map';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import { useEffect } from 'react';
import { mapAtom } from '../map/atoms';
import { hoveredFunnIdAtom, selectedFunnIdAtom } from './atoms';
import { FUNN_ID_PROPERTY, getFunnLayer } from './funnLayer';

// Halo under the funn the list is pointing at. A separate layer rather
// than a style swap on funnLayer: those features carry the per-feature
// style they were drawn with (round-tripped through the GeoJSON
// properties), so overriding them to show emphasis would lose the
// drawing and restoring it afterwards means reconstructing that style.
// Cloning the geometry one layer down costs nothing and is reversible.

const HIGHLIGHT_LAYER_ID = 'funnHighlightLayer';

const halo = (color: string, width: number) =>
  new Style({
    stroke: new Stroke({ color, width }),
    fill: new Fill({ color: 'rgba(255, 255, 255, 0.15)' }),
    image: new CircleStyle({
      radius: width * 3.5,
      fill: new Fill({ color: 'rgba(255, 255, 255, 0.15)' }),
      stroke: new Stroke({ color, width }),
    }),
  });

// Selected reads louder than hovered — the pointer already tells you
// where the hover is, the selection has to survive looking away.
const SELECTED_STYLE = halo('rgba(255, 106, 0, 0.9)', 10);
const HOVERED_STYLE = halo('rgba(255, 106, 0, 0.45)', 8);

const getHighlightLayer = (map: Map): VectorLayer | null =>
  (map
    .getLayers()
    .getArray()
    .find((l) => l.get('id') === HIGHLIGHT_LAYER_ID) as
    | VectorLayer
    | undefined) ?? null;

// Mount from Layout, next to useFunnLayer. Keeps the halo in sync with
// the two pointer atoms; clears itself when neither is set.
export const useFunnHighlightLayer = () => {
  const map = useAtomValue(mapAtom);
  const hovered = useAtomValue(hoveredFunnIdAtom);
  const selected = useAtomValue(selectedFunnIdAtom);

  useEffect(() => {
    let layer = getHighlightLayer(map);
    if (!layer) {
      layer = new VectorLayer({
        source: new VectorSource(),
        // Under funnLayer (5) so the drawing stays legible on top of it.
        zIndex: 4.5,
        properties: { id: HIGHLIGHT_LAYER_ID },
      });
      map.addLayer(layer);
    }

    const source = layer.getSource()!;
    source.clear();

    const funnSource = getFunnLayer()?.getSource();
    if (!funnSource) return;

    // Hover on top of an already-selected row is not a second halo.
    const targets: [string | null, Style][] = [
      [selected, SELECTED_STYLE],
      [hovered === selected ? null : hovered, HOVERED_STYLE],
    ];

    for (const [id, style] of targets) {
      if (!id) continue;
      for (const f of funnSource.getFeatures()) {
        if (f.get(FUNN_ID_PROPERTY) !== id) continue;
        const geometry = f.getGeometry();
        if (!geometry) continue;
        const clone = new Feature({ geometry: geometry.clone() });
        clone.setStyle(style);
        source.addFeature(clone);
      }
    }

    return () => {
      source.clear();
    };
  }, [map, hovered, selected]);
};
