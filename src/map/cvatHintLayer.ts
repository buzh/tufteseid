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

const CVAT_HINT_ID_PREFIX = 'cvatHint.';

const CVAT_HINT_Z_INDEX = 0.5;

const hintLayers = (map: OlMap): BaseLayer[] =>
  map
    .getLayers()
    .getArray()
    .filter((l) => String(l.get('id') ?? '').startsWith(CVAT_HINT_ID_PREFIX));

const buildHintLayer = (acquisition: CvatAcquisition) => {
  const layer = getXYZLayer(buildCvatGroundConfig(acquisition));
  if (!layer) return null;
  layer.set('id', `${CVAT_HINT_ID_PREFIX}${acquisition.path}`);
  layer.setZIndex(CVAT_HINT_Z_INDEX);

  layer.setMinResolution(AUTO_ENGAGE_M_PER_PX);
  layer.setVisible(false);
  return layer;
};

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
