

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

const MIN_FLYFOTO_ZOOM = 8;

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

  useEffect(() => {
    if (!isFlyfotoBackground) return;
    let cancelled = false;

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

      const request = ++latestRequest;
      inFlight?.abort();
      inFlight = null;

      const zoom = map.getView().getZoom();
      if (zoom == null || zoom < MIN_FLYFOTO_ZOOM - 0.001) {
        setViewport({ status: 'zoomedOut', projects: [] });
        return;
      }

      const controller = new AbortController();
      inFlight = controller;

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

    viewport,
    projects,
    era,
    setEra,
    eraCounts,
    activateMosaic,
    activateProject,

    enterFlyfoto: () => {
      if (!isFlyfotoBackground) setBackgroundLayer('flyfoto');
    },
  };
};

export type FlyfotoControls = ReturnType<typeof useFlyfotoControls>;
