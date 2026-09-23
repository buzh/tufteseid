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

/** Must stay outside the `bg.` namespace: `swapBackgroundLayers` sweeps every
 *  `bg.` layer that is not in the stack it is installing. */
const CVAT_HINT_ID_PREFIX = 'cvatHint.';

// Over every ground (0), under hybrid's topo overlay (0.75) and everything
// above it. See the z-order table in `docs/map-layers.md`.
const CVAT_HINT_Z_INDEX = 0.5;

const hintLayers = (map: OlMap): BaseLayer[] =>
  map
    .getLayers()
    .getArray()
    .filter((l) => String(l.get('id') ?? '').startsWith(CVAT_HINT_ID_PREFIX));

/**
 * One acquisition's layer. `getXYZLayer` supplies the extent culling, without
 * which every acquisition asks for the whole screen and takes hundreds of 404s
 * per pan.
 */
const buildHintLayer = (acquisition: CvatAcquisition) => {
  const layer = getXYZLayer(buildCvatGroundConfig(acquisition));
  if (!layer) return null;
  layer.set('id', `${CVAT_HINT_ID_PREFIX}${acquisition.path}`);
  layer.setZIndex(CVAT_HINT_Z_INDEX);
  // Deep end of the band; the coarse end is the config's `maxResolution`.
  layer.setMinResolution(AUTO_ENGAGE_M_PER_PX);
  layer.setVisible(false);
  return layer;
};

/** Mount once. */
export const useCvatHintLayer = () => {
  const map = useAtomValue(mapAtom);
  const mode = useAtomValue(viewModeAtom);
  const backgroundLayers = useAtomValue(liveBackgroundLayersAtom);
  const [cached, setCached] = useState<CvatAcquisition[]>([]);

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
    // Worst first: layers sharing a z-index draw in the order they were added,
    // so the highest-ranked overlapping flight ends up on top.
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

  useEffect(() => {
    const showing = mode === 'single' && LIDAR_LAYERS.has(backgroundLayers[0]);
    for (const layer of hintLayers(map)) layer.setVisible(showing);
  }, [map, mode, backgroundLayers, cached]);
};
