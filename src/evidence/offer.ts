// What the reading on screen offers to keep. Two of them, because two things
// can be worth keeping at once: the ground the A half is drawing, and the
// terrain analysis laid over it.
//
// The ground's offer is derived — every parameter it needs is already an atom,
// and a second copy could disagree with the map. The terrain analysis keeps its
// settings in component state, so `useTerrainControls` publishes its offer
// instead.
//
// An offer is parameters, not pixels: keeping re-renders them over the spot's
// footprint at the source's own resolution, which is not the rectangle or the
// resolution on screen.

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
          projectMetresPerPx: project.metresPerPx,
        }
      : {
          kind: 'flyfoto',
          projectId: NIB_MOSAIC,
          projectName: null,
          year: null,
          photoDate: null,
          projectMetresPerPx: null,
        };
  }

  // Cartography and the empty ground offer nothing to re-render, and
  // `lidarCvat` is our own store: no service publishes that render, so a
  // native-resolution copy of it cannot be asked for.
  return null;
});

/** Written by `useTerrainControls` while the analysis has something to show. */
export const terrainOfferAtom = atom<EvidenceSpec | null>(null);

/** The offers standing, ground first — the order they are stacked in. */
export const keepOffersAtom = atom<EvidenceSpec[]>((get) =>
  [get(groundOfferAtom), get(terrainOfferAtom)].filter(
    (spec): spec is EvidenceSpec => spec !== null,
  ),
);
