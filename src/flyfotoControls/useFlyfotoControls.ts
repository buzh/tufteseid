// The archive index is one ArcGIS query per moveend, so it is only asked while
// Flyfoto is that half's ground.

import { useAtom, useAtomValue } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useEffect, useMemo, useState } from 'react';
import { mapAtom } from '../map/atoms';
import type { CompareHalf } from '../map/compare/halves';
import { backgroundLayerHalves } from '../map/layers/config/backgroundLayers/atoms';
import { activeFlyfotoProjectHalves } from '../map/layers/config/backgroundLayers/flyfotoBackground';
import {
  fetchFlyfotoProjectsForBbox,
  type FlyfotoProject,
} from '../map/layers/config/backgroundLayers/flyfotoProjects';
import { countByEra, filterByEra, type FlyfotoEra } from './eras';

// Furthest out the list is worth answering: a flight covers a town, so a
// regional view already intersects several hundred of them.
const MIN_FLYFOTO_ZOOM = 8;

// Matches REFRESH_DEBOUNCE_MS in lidarFootprintsLayer.ts; the two viewport
// passes answer the same shape of question and should cost the same.
const REFRESH_DEBOUNCE_MS = 250;

type FlyfotoViewportStatus =
  'idle' | 'loading' | 'ready' | 'zoomedOut' | 'error';

type FlyfotoViewport = {
  status: FlyfotoViewportStatus;
  projects: FlyfotoProject[];
};

const EMPTY_VIEWPORT: FlyfotoViewport = { status: 'idle', projects: [] };

export const useFlyfotoControls = (half: CompareHalf) => {
  const map = useAtomValue(mapAtom);
  const [backgroundLayer, setBackgroundLayer] = useAtom(
    backgroundLayerHalves[half],
  );
  const [activeProject, setActiveProject] = useAtom(
    activeFlyfotoProjectHalves[half],
  );

  const [viewport, setViewport] = useState<FlyfotoViewport>(EMPTY_VIEWPORT);
  const [era, setEra] = useState<FlyfotoEra>('all');

  const isMosaic = backgroundLayer === 'flyfoto';
  const isProject = backgroundLayer === 'flyfotoProject';
  const isFlyfotoBackground = isMosaic || isProject;

  // One query per moveend, answered out of wmscache for a view already seen.
  useEffect(() => {
    if (!isFlyfotoBackground) return;
    let cancelled = false;
    // Panning refreshes faster than the service answers; only the newest writes.
    let latestRequest = 0;
    let inFlight: AbortController | null = null;

    const refresh = () => {
      const size = map.getSize();
      if (!size) return;
      const extent = map.getView().calculateExtent(size);
      const projection = map.getView().getProjection().getCode();
      const extentLonLat = transformExtent(extent, projection, 'EPSG:4326') as
        [number, number, number, number] | undefined;
      if (!extentLonLat) return;

      // Claimed before the zoom check too, so a fetch started while zoomed in
      // cannot land afterwards and overwrite the state.
      const request = ++latestRequest;
      inFlight?.abort();
      inFlight = null;

      // getZoom() is a log2 of the resolution, so an integral zoom can come
      // back a hair under itself; the epsilon keeps the threshold level usable.
      const zoom = map.getView().getZoom();
      if (zoom == null || zoom < MIN_FLYFOTO_ZOOM - 0.001) {
        setViewport({ status: 'zoomedOut', projects: [] });
        return;
      }

      const controller = new AbortController();
      inFlight = controller;
      // Keep the rows while the next view loads, or the menu flickers.
      setViewport((prev) => ({ ...prev, status: 'loading' }));

      fetchFlyfotoProjectsForBbox(extentLonLat, controller.signal)
        .then((projects) => {
          if (cancelled || request !== latestRequest) return;
          setViewport({ status: 'ready', projects });
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          console.warn('[flyfoto] viewport refresh failed', err);
          if (cancelled || request !== latestRequest) return;
          setViewport({ status: 'error', projects: [] });
        });
    };

    refresh();
    let debounce: number | undefined;
    const onMoveEnd = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(refresh, REFRESH_DEBOUNCE_MS);
    };
    map.on('moveend', onMoveEnd);
    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
      inFlight?.abort();
      map.un('moveend', onMoveEnd);
      // Emptied on the way out, not on the way in: the rows belong to the
      // viewport they were read over.
      setViewport(EMPTY_VIEWPORT);
    };
  }, [map, isFlyfotoBackground]);

  const projects = useMemo(
    () => filterByEra(viewport.projects, era),
    [viewport.projects, era],
  );
  const eraCounts = useMemo(
    () => countByEra(viewport.projects),
    [viewport.projects],
  );

  const activateMosaic = () => setBackgroundLayer('flyfoto');
  const activateProject = (p: FlyfotoProject) => {
    setActiveProject(p);
    setBackgroundLayer('flyfotoProject');
  };

  return {
    isMosaic,
    isProject,
    activeProject,
    /** The raw query; `projects` is the same list after the period filter. */
    viewport,
    projects,
    era,
    setEra,
    eraCounts,
    activateMosaic,
    activateProject,
    // The mosaic always: it is the only member that renders everywhere.
    enterFlyfoto: () => {
      if (!isFlyfotoBackground) setBackgroundLayer('flyfoto');
    },
  };
};

export type FlyfotoControls = ReturnType<typeof useFlyfotoControls>;
