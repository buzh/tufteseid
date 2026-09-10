import { useAtom, useAtomValue } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useEffect, useState } from 'react';
import { lidarExtractViewerOpenAtom } from '../../lidarExtract/atoms';
import {
  fetchFlyfotoProjectsForBbox,
  type FlyfotoProject,
} from '../../localities/flyfotoProjects';
import { mapAtom } from '../../map/atoms';
import { backgroundLayerAtom } from '../../map/layers/config/backgroundLayers/atoms';
import { activeFlyfotoProjectAtom } from '../../map/layers/config/backgroundLayers/flyfotoBackground';
import type { CycleKey } from '../../map/useBackgroundCyclingKeys';

// Furthest out the acquisition list is worth answering. Same reasoning as
// MIN_FOOTPRINT_ZOOM in lidarFootprintsLayer, one level tighter: a flight
// covers a town rather than a county, so the count climbs faster on the way
// out — a regional view already intersects several hundred acquisitions,
// and "these 400 flights touch this screen" is not a choice anyone is
// making.
const MIN_FLYFOTO_ZOOM = 8;

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

/**
 * Everything the flyfoto controls in the ribbon share: whether ortofoto is
 * the background at all, which acquisition is painting it, what the viewport
 * has to offer, and the W/S behaviour.
 *
 * Shaped after useLidarControls, but simpler in two ways that are worth
 * stating rather than rediscovering. Nothing on the map draws acquisition
 * footprints, so the list is plain component state instead of a shared atom
 * — and fetchFlyfotoProjectsForBbox doesn't return geometry to draw them
 * with anyway. And the list is one cached ArcGIS query rather than a fan-out
 * of footprint requests, so it is simply kept warm for the whole time
 * flyfoto is the background: no cycling flag, and no first W/S press that
 * only starts a fetch.
 *
 * Mount once, from RibbonGlobalRow.
 */
export const useFlyfotoControls = () => {
  const map = useAtomValue(mapAtom);
  const [backgroundLayer, setBackgroundLayer] = useAtom(backgroundLayerAtom);
  const [activeProject, setActiveProject] = useAtom(activeFlyfotoProjectAtom);
  const extractViewerOpen = useAtomValue(lidarExtractViewerOpenAtom);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewport, setViewport] = useState<FlyfotoViewport>(EMPTY_VIEWPORT);

  const isMosaic = backgroundLayer === 'flyfoto';
  const isProject = backgroundLayer === 'flyfotoProject';
  const isFlyfotoMode = isMosaic || isProject;

  // Which acquisitions cover the current view. Refetched on every moveend
  // while flyfoto is the background — one query, answered from wmscache for
  // any view anyone has already looked at.
  useEffect(() => {
    if (!isFlyfotoMode) {
      setViewport(EMPTY_VIEWPORT);
      return;
    }
    let cancelled = false;
    // Panning fires refreshes faster than the service answers them; only the
    // newest may write, or a slow early response overwrites the list for
    // where the user actually ended up.
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

      // Claimed before the zoom check as well, so a fetch started while
      // zoomed in can't land afterwards and overwrite the guard state.
      const request = ++latestRequest;
      inFlight?.abort();
      inFlight = null;

      // getZoom() is a log2 of the resolution, so an integral zoom can come
      // back a hair under itself — don't lock the user out of the threshold
      // level they are standing on.
      const zoom = map.getView().getZoom();
      if (zoom == null || zoom < MIN_FLYFOTO_ZOOM - 0.001) {
        setViewport({ status: 'zoomedOut', projects: [] });
        return;
      }

      const controller = new AbortController();
      inFlight = controller;
      // Keep the rows that are up while the next view loads: they are
      // usually the same rows, and blanking the list on every pan makes the
      // pulldown flicker.
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
    map.on('moveend', refresh);
    return () => {
      cancelled = true;
      inFlight?.abort();
      map.un('moveend', refresh);
    };
  }, [map, isFlyfotoMode]);

  // Leaving flyfoto mode unmounts the pulldown without it ever firing its
  // open-change callback. The active acquisition is kept, the way the LiDAR
  // one is: coming back should return to the year you left on.
  useEffect(() => {
    if (!isFlyfotoMode) setPickerOpen(false);
  }, [isFlyfotoMode]);

  const selectMosaic = () => setBackgroundLayer('flyfoto');
  const selectProject = (p: FlyfotoProject) => {
    setActiveProject(p);
    setBackgroundLayer('flyfotoProject');
  };
  // Clicking a row picks *and* dismisses; the keyboard path below picks
  // without closing, so you can watch the selection walk the open list.
  const activateMosaic = () => {
    selectMosaic();
    setPickerOpen(false);
  };
  const activateProject = (p: FlyfotoProject) => {
    selectProject(p);
    setPickerOpen(false);
  };

  // W/S walks the acquisition ring — the same ground in 2024, 1963 and 1937
  // without leaving the map, which is the point of the mode. A/D and E are
  // LiDAR's and are declined here so its handler gets them.
  const cycle = (key: CycleKey): boolean => {
    // The extract viewer covers the map: swapping the background behind it
    // would be invisible and still cost a full round of tile loads.
    if (!isFlyfotoMode || extractViewerOpen) return false;
    if (key !== 'w' && key !== 's') return false;
    // Consumed even with nothing to walk to. In flyfoto mode W/S is this
    // ring, and the list being mid-refresh after a pan is a transient the
    // key should wait out rather than fall through on.
    if (viewport.status !== 'ready' || viewport.projects.length === 0) {
      return true;
    }

    const step = key === 's' ? 1 : -1;
    // Index 0 is the seamless mosaic, then the acquisitions newest first —
    // same order the pulldown lists them in, so S walks back in time.
    const entries = viewport.projects;
    const ring = entries.length + 1;
    const at = entries.findIndex((p) => p.id === activeProject?.id);
    const from = isMosaic ? 0 : at >= 0 ? at + 1 : step > 0 ? -1 : 0;
    const next = (from + step + ring) % ring;
    if (next === 0) selectMosaic();
    else selectProject(entries[next - 1]);
    return true;
  };

  return {
    // Keyboard
    cycle,
    // Mode
    isFlyfotoMode,
    isMosaic,
    isProject,
    activeProject,
    // Dataset
    viewport,
    pickerOpen,
    setPickerOpen,
    activateMosaic,
    activateProject,
    // Entering the mode from the ribbon's mode button. The mosaic is the
    // only thing that renders everywhere, so it's what "Flyfoto" means
    // until an acquisition is picked.
    enterFlyfoto: () => {
      if (!isFlyfotoMode) setBackgroundLayer('flyfoto');
    },
  };
};

export type FlyfotoControls = ReturnType<typeof useFlyfotoControls>;
