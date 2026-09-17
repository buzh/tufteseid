import { useAtom, useAtomValue } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchFlyfotoProjectsForBbox,
  type FlyfotoProject,
} from '../../localities/flyfotoProjects';
import { mapAtom } from '../../map/atoms';
import { backgroundLayerAtom } from '../../map/layers/config/backgroundLayers/atoms';
import { activeFlyfotoProjectAtom } from '../../map/layers/config/backgroundLayers/flyfotoBackground';
import type { CycleKey } from '../../map/useBackgroundCyclingKeys';
import { countByEra, filterByEra, type FlyfotoEra } from './eras';

// Furthest out the acquisition list is worth answering: a flight covers a
// town, so a regional view already intersects several hundred of them.
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
 * Mount once, from RibbonGlobalRow. The list is one cached ArcGIS query, not a
 * fan-out like LiDAR's footprints, so it needs no cycling flag.
 * `isFlyfotoBackground` is not "ortofoto is the ground being read" — Terreng
 * covers the background without replacing it.
 */
export const useFlyfotoControls = () => {
  const map = useAtomValue(mapAtom);
  const [backgroundLayer, setBackgroundLayer] = useAtom(backgroundLayerAtom);
  const [activeProject, setActiveProject] = useAtom(activeFlyfotoProjectAtom);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewport, setViewport] = useState<FlyfotoViewport>(EMPTY_VIEWPORT);
  const [era, setEra] = useState<FlyfotoEra>('all');

  const isMosaic = backgroundLayer === 'flyfoto';
  const isProject = backgroundLayer === 'flyfotoProject';
  const isFlyfotoBackground = isMosaic || isProject;

  // One query per moveend, answered from wmscache for a view already seen.
  useEffect(() => {
    if (!isFlyfotoBackground) {
      setViewport(EMPTY_VIEWPORT);
      return;
    }
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
      // Keep the rows while the next view loads, or the pulldown flickers.
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
  }, [map, isFlyfotoBackground]);

  // The period-filtered list, which is what rows, counts and W/S all walk.
  const projects = useMemo(
    () => filterByEra(viewport.projects, era),
    [viewport.projects, era],
  );
  const eraCounts = useMemo(
    () => countByEra(viewport.projects),
    [viewport.projects],
  );

  // Called by useGroundMode: unmounting the pulldown never fires its
  // open-change callback. The acquisition is kept, so you return to that year.
  const standDown = useCallback(() => setPickerOpen(false), []);

  const selectMosaic = () => setBackgroundLayer('flyfoto');
  const selectProject = (p: FlyfotoProject) => {
    setActiveProject(p);
    setBackgroundLayer('flyfotoProject');
  };
  // A row click picks and dismisses; W/S below picks without closing.
  const activateMosaic = () => {
    selectMosaic();
    setPickerOpen(false);
  };
  const activateProject = (p: FlyfotoProject) => {
    selectProject(p);
    setPickerOpen(false);
  };

  // W/S walks the acquisitions. Dispatched by useGroundMode, so no mode check.
  const cycle = (key: CycleKey): boolean => {
    if (key !== 'w' && key !== 's') return false;
    // Consumed even with nothing to walk to: a list mid-refresh is a transient
    // the key should wait out rather than fall through on.
    if (viewport.status !== 'ready' || projects.length === 0) {
      return true;
    }

    const step = key === 's' ? 1 : -1;
    // Index 0 is the mosaic, then the acquisitions newest first as the pulldown
    // lists them, so S walks back in time.
    const entries = projects;
    const ring = entries.length + 1;
    const at = entries.findIndex((p) => p.id === activeProject?.id);
    const from = isMosaic ? 0 : at >= 0 ? at + 1 : step > 0 ? -1 : 0;
    const next = (from + step + ring) % ring;
    if (next === 0) selectMosaic();
    else selectProject(entries[next - 1]);
    return true;
  };

  return {
    cycle,
    isFlyfotoBackground,
    isMosaic,
    isProject,
    standDown,
    activeProject,
    // `viewport` is the raw query; `projects` is it after the period chips, and
    // is what walking or listing should use.
    viewport,
    projects,
    era,
    setEra,
    eraCounts,
    pickerOpen,
    setPickerOpen,
    activateMosaic,
    activateProject,
    // The mosaic is the only thing that renders everywhere.
    enterFlyfoto: () => {
      if (!isFlyfotoBackground) setBackgroundLayer('flyfoto');
    },
  };
};

export type FlyfotoControls = ReturnType<typeof useFlyfotoControls>;
