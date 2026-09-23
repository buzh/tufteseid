// The cached store, drawn as its own coverage. Out where the relief on screen
// is the national mosaic, every acquisition in the store paints its own tiles
// over it — so a reader looking at a county sees which parts of it have been
// rendered from the LiDAR and can zoom into one, rather than having to arrive
// over a flight before anything tells them the picture exists. Nothing is
// legible at that scale and nothing is meant to be: the patch is the invitation.
//
// At full strength, not a wash. The store's render is grey-brown VAT against
// MapProxy's grey hillshade, and the two are close enough that a faded patch
// reads as a rendering artefact rather than as a different picture. The radii
// are RVT's pixels at every level (`cvatGround.ts`), so a z8 tile is a genuine
// physiographic relief of the same ground and stands its own against the
// mosaic.
//
// It stops where Automatisk starts. Below 1 m/px the reader is being given a
// flight — the cached ground among its styles — and a second copy of the store
// painted over the top of that choice would be drawing the same tiles twice and
// covering up a comparison. The band is therefore the store's coarsest level up
// to the resolution the dataset logic engages at.
//
// One layer per acquisition, because a tile carries no provenance and each
// acquisition has a namespace of its own. That is the size of the store — tens
// — and not of the catalogue, whose 450 flights never reach this module.

import { useAtomValue } from 'jotai';
import type BaseLayer from 'ol/layer/Base';
import type OlMap from 'ol/Map';
import { useEffect, useState } from 'react';
import { mapAtom } from './atoms';
import { viewModeAtom } from './compare/halves';
import { liveBackgroundLayersAtom } from './layers/config/backgroundLayers/atoms';
import {
  buildCvatGroundConfig,
  type CvatAcquisition,
  fetchCvatAcquisitions,
} from './layers/config/backgroundLayers/cvatGround';
import { AUTO_ENGAGE_M_PER_PX } from './layers/config/backgroundLayers/lidarAuto';
import { sortProjectsByRelevance } from './layers/config/backgroundLayers/lidarProjects';
import { LIDAR_LAYERS } from './layers/config/backgroundLayers/stack';
import { getXYZLayer } from './layers/config/backgroundLayers/utils';

/** Outside the `bg.` namespace on purpose: `swapBackgroundLayers` sweeps
 *  everything with that prefix that is not in the stack it is installing, and
 *  the hint belongs to no stack — it is drawn over whichever one is up. */
const CVAT_HINT_ID_PREFIX = 'cvatHint.';

// Over every ground (0) and under everything drawn on top of one: the terrain
// render at 1, the footprints at 3, the reader's own pins at 6.
const CVAT_HINT_Z_INDEX = 0.5;

const hintLayers = (map: OlMap): BaseLayer[] =>
  map
    .getLayers()
    .getArray()
    .filter((l) => String(l.get('id') ?? '').startsWith(CVAT_HINT_ID_PREFIX));

/**
 * The store's own layer for one acquisition: the ground config, with the band
 * and the place in the stack that make it a hint rather than a background.
 *
 * `getXYZLayer` gives the grid, the sparse guard and the extent culling, all of
 * which are the same question here as they are for the ground — which tiles of
 * this store may be asked for. The extent matters more at this scale than at
 * any other: without it every acquisition would ask for the whole screen and be
 * told 404 a few hundred times a pan.
 */
const buildHintLayer = (acquisition: CvatAcquisition) => {
  const layer = getXYZLayer(buildCvatGroundConfig(acquisition));
  if (!layer) return null;
  layer.set('id', `${CVAT_HINT_ID_PREFIX}${acquisition.path}`);
  layer.setZIndex(CVAT_HINT_Z_INDEX);
  // The deep end of the band. `maxResolution` — the coarse end, one step above
  // the store's own coarsest level — comes with the config.
  layer.setMinResolution(AUTO_ENGAGE_M_PER_PX);
  layer.setVisible(false);
  return layer;
};

/** Mount once, from whatever owns the map's side effects. */
export const useCvatHintLayer = () => {
  const map = useAtomValue(mapAtom);
  const mode = useAtomValue(viewModeAtom);
  const backgroundLayers = useAtomValue(liveBackgroundLayersAtom);
  const [cached, setCached] = useState<CvatAcquisition[]>([]);

  // Once a session. The store grows by a file landing on the server, and the
  // manifest fetch behind this is shared with the footprint layer's held mode.
  useEffect(() => {
    let alive = true;
    fetchCvatAcquisitions()
      .then((acquisitions) => {
        if (alive) setCached(acquisitions);
      })
      .catch((err) => console.warn('[cvatHint] store unreadable', err));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    // Worst first, since layers sharing a z-index draw in the order they were
    // added: where two flights overlap, the one the app would rank highest is
    // the one on top, so the patch agrees with what a zoom into it will give.
    const ordered = [...cached]
      .sort((a, b) => sortProjectsByRelevance(a.project, b.project))
      .reverse();
    for (const acquisition of ordered) {
      const id = `${CVAT_HINT_ID_PREFIX}${acquisition.path}`;
      if (hintLayers(map).some((l) => l.get('id') === id)) continue;
      const layer = buildHintLayer(acquisition);
      if (layer) map.addLayer(layer);
    }
  }, [map, cached]);

  // Only over relief, and only while one ground is up. In a two-ground view the
  // reader has asked for a comparison, and store patches painted over both
  // sides of it — or, in the split, over one pane and not the other, since the
  // second pane is a map of its own — would be answering a question nobody put.
  useEffect(() => {
    const showing = mode === 'single' && LIDAR_LAYERS.has(backgroundLayers[0]);
    for (const layer of hintLayers(map)) layer.setVisible(showing);
  }, [map, mode, backgroundLayers, cached]);
};
