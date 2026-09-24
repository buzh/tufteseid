import { useAtomValue } from 'jotai';
import ImageLayer from 'ol/layer/Image';
import Static from 'ol/source/ImageStatic';
import { useEffect, useRef } from 'react';

import { mapAtom } from '../map/atoms';

// Over the terrain-analysis render (1), under the B half (1.5) so the curtain
// reads a kept render against a live ground, and under the drawing (2).
// Inventory in docs/map-layers.md.
const Z_INDEX = 1.25;

const LAYER_ID = 'spotEvidenceOverlay';

/**
 * Draws `url` over `extent`, or nothing for either missing. `opacity` is 0–1.
 * The extent is EPSG:25833 whatever the view is in; `ImageStatic` reprojects.
 */
export const useEvidenceOverlay = (
  url: string,
  extent: [number, number, number, number] | null,
  opacity: number,
) => {
  const map = useAtomValue(mapAtom);
  const [minX, minY, maxX, maxY] = extent ?? [NaN, NaN, NaN, NaN];

  // Oldest first. These outlive the effect that made them on purpose: the
  // outgoing picture comes off only once the incoming one has pixels, so that
  // flipping between two renders of one ground never blinks.
  const shown = useRef<ImageLayer<Static>[]>([]);

  useEffect(() => {
    const retireAll = () => {
      for (const layer of shown.current) map.removeLayer(layer);
      shown.current = [];
    };

    if (!url || !Number.isFinite(minX)) {
      retireAll();
      return;
    }

    const source = new Static({
      url,
      projection: 'EPSG:25833',
      imageExtent: [minX, minY, maxX, maxY],
    });
    const layer = new ImageLayer({
      source,
      opacity,
      zIndex: Z_INDEX,
      properties: { id: LAYER_ID },
    });
    map.addLayer(layer);

    const outgoing = shown.current;
    shown.current = [...outgoing, layer];

    const retireOutgoing = () => {
      for (const old of outgoing) map.removeLayer(old);
      shown.current = shown.current.filter((l) => !outgoing.includes(l));
    };
    source.once('imageloadend', retireOutgoing);
    // Or an image that never arrives leaves the previous one up for ever.
    source.once('imageloaderror', retireOutgoing);

    // No cleanup: taking this layer off is the next one's job, and the unmount
    // effect below sweeps whatever is left.

    // `opacity` is seeded here and kept in step by the effect below. Naming it
    // would rebuild the layer on every drag of the slider, and with it the
    // flash this swap exists to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, url, minX, minY, maxX, maxY]);

  useEffect(() => {
    for (const layer of shown.current) layer.setOpacity(opacity);
  }, [opacity]);

  useEffect(
    () => () => {
      for (const layer of shown.current) map.removeLayer(layer);
      shown.current = [];
    },
    [map],
  );
};
