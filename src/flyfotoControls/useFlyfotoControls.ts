// The Flyfoto arm's controller: the seamless NiB mosaic, or one acquisition
// out of the archive over the viewport.
//
// One per half, and the half is the only thing that differs between them. The
// list is one cached ArcGIS query per moveend rather than LiDAR's WFS fan-out,
// so two panes both on Flyfoto cost one duplicate query — answered out of
// wmscache, since the two ask the same viewport the same question.
//
// Only queried while Flyfoto is that half's ground. The archive index is an
// upstream call on every pan, and an arm that is not on screen has nobody to
// answer.

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

// Furthest out the acquisition list is worth answering: a flight covers a town,
// so a regional view already intersects several hundred of them.
const MIN_FLYFOTO_ZOOM = 8;

// Matches REFRESH_DEBOUNCE_MS in lidarFootprintsLayer.ts; the two viewport
// passes answer the same shape of question and should cost the same.
const REFRESH_DEBOUNCE_MS = 250;

export type FlyfotoViewportStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'zoomedOut'
  | 'error';

export type FlyfotoViewport = {
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
    // Panning fires refreshes faster than the service answers, so only the
    // newest may write.
    let latestRequest = 0;
    let inFlight: AbortController | null = null;

    const refresh = () => {
      const size = map.getSize();
      if (!size) return;
      const extent = map.getView().calculateExtent(size);
      const projection = map.getView().getProjection().getCode();
      const extentLonLat = transformExtent(extent, projection, 'EPSG:4326') as
        | [number, number, number, number]
        | undefined;
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
    // Same 250 ms as the LiDAR footprint pass, for the same reason: a pan that
    // ends in two or three quick moveends should cost one archive query rather
    // than three. Aborting the superseded ones cuts our wait, not the work the
    // ImageServer has already started.
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
      // Emptied on the way out, not on the way in: the rows belong to a
      // viewport read while Flyfoto was the ground, and a reader who leaves,
      // pans across the country and comes back must not be shown the last
      // place's flights while the next query lands.
      setViewport(EMPTY_VIEWPORT);
    };
  }, [map, isFlyfotoBackground]);

  // The period-filtered list, which is what the rows walk.
  const projects = useMemo(
    () => filterByEra(viewport.projects, era),
    [viewport.projects, era],
  );
  const eraCounts = useMemo(
    () => countByEra(viewport.projects),
    [viewport.projects],
  );

  const activateMosaic = () => setBackgroundLayer('flyfoto');
  // The acquisition travels with the ground, as the LiDAR flight does, so the
  // stack never has to ask whether the two agree.
  const activateProject = (p: FlyfotoProject) => {
    setActiveProject(p);
    setBackgroundLayer('flyfotoProject');
  };

  return {
    isMosaic,
    isProject,
    activeProject,
    // `viewport` is the raw query — its status is what the menu reports on;
    // `projects` is the same list after the period chips, and is what it lists.
    viewport,
    projects,
    era,
    setEra,
    eraCounts,
    activateMosaic,
    activateProject,
    // The mosaic, always: it is the only member that renders everywhere, and
    // the acquisition the reader left is kept, so the menu still opens on it.
    enterFlyfoto: () => {
      if (!isFlyfotoBackground) setBackgroundLayer('flyfoto');
    },
  };
};

export type FlyfotoControls = ReturnType<typeof useFlyfotoControls>;
