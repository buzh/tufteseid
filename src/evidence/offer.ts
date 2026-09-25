import { atom } from 'jotai';

import { NATIONAL_LIDAR_LABEL } from '../lidarExtract/sources';
import { backgroundLayerHalves } from '../map/layers/config/backgroundLayers/atoms';
import { activeFlyfotoProjectHalves } from '../map/layers/config/backgroundLayers/flyfotoBackground';
import {
  activeLidarModelHalves,
  activeLidarProjectHalves,
  activeLidarStyleHalves,
  effectiveLidarStyle,
} from '../map/layers/config/backgroundLayers/lidarProjects';
import { NIB_MOSAIC, type EvidenceSpec } from './spec';

const groundOfferAtom = atom<EvidenceSpec | null>((get) => {
  const layer = get(backgroundLayerHalves.a);

  if (layer === 'lidarHillshade' || layer === 'lidarProject') {
    const model = get(activeLidarModelHalves.a);
    const style = effectiveLidarStyle(get(activeLidarStyleHalves.a), model);
    const project =
      layer === 'lidarProject' ? get(activeLidarProjectHalves.a) : null;
    return project
      ? {
          kind: 'lidar',
          // The key `enumerateLidarSources` will be searched by.
          sourceKey: `project:${project.projectName}`,
          sourceLabel: project.projectName,
          style,
          model,
          year: project.year,
          pointDensity: project.pointDensity,
        }
      : {
          kind: 'lidar',
          sourceKey: 'national',
          sourceLabel: NATIONAL_LIDAR_LABEL,
          style,
          model,
          year: null,
          pointDensity: null,
        };
  }

  if (layer === 'flyfoto' || layer === 'flyfotoProject') {
    const project =
      layer === 'flyfotoProject' ? get(activeFlyfotoProjectHalves.a) : null;
    return project
      ? {
          kind: 'flyfoto',
          projectId: project.id,
          projectName: project.projectName,
          year: project.year,
          photoDate: project.photoDate,
        }
      : {
          kind: 'flyfoto',
          projectId: NIB_MOSAIC,
          projectName: null,
          year: null,
          photoDate: null,
        };
  }

  // `lidarCvat` is our own store: no service publishes that render, so a
  // native-resolution copy of it cannot be asked for. Cartography and the
  // empty ground have nothing to re-render either.
  return null;
});

/** Written by `useTerrainControls` while the analysis has something to show,
 *  because its settings are component state rather than atoms. */
export const terrainOfferAtom = atom<EvidenceSpec | null>(null);

/**
 * The one offer standing: what the camera in the spot card would keep of the
 * view as it is. The analysis wins when one is running, because it is then what
 * the reader is looking at — the ground it was computed from is underneath it.
 *
 * An offer is parameters, not pixels: keeping it re-renders over the spot's
 * footprint at the source's own resolution, not the rectangle or the resolution
 * on screen.
 */
export const keepOfferAtom = atom<EvidenceSpec | null>(
  (get) => get(terrainOfferAtom) ?? get(groundOfferAtom),
);
