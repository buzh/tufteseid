import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type LidarSource,
  nationalLidarSource,
  projectLidarSource,
} from '../../lidarExtract/sources';
import { mapAtom } from '../../map/atoms';
import {
  backgroundLayerAtom,
  hybridContoursAtom,
  hybridOverlayAtom,
} from '../../map/layers/config/backgroundLayers/atoms';
import {
  chooseAutoDataset,
  lidarAutoDatasetAtom,
} from '../../map/layers/config/backgroundLayers/lidarAuto';
import {
  activeLidarModelAtom,
  activeLidarProjectAtom,
  activeLidarStyleAtom,
  bboxIntersects,
  DEFAULT_LIDAR_PROJECT_STYLE,
  effectiveLidarStyle,
  fetchLidarProjects,
  fetchNationalLidarStyles,
  type LidarProject,
  resolveLidarStyle,
  stylesForModel,
  TIER_A_STYLES,
} from '../../map/layers/config/backgroundLayers/lidarProjects';
import {
  hoveredLidarProjectIdAtom,
  lidarCyclingAtom,
  lidarPickerOpenAtom,
  lidarViewportAtom,
} from '../../map/layers/config/backgroundLayers/lidarRelevance';
import type { CycleKey } from '../../map/useBackgroundCyclingKeys';

// How long after the last W/S press the dataset list stays warm.
const CYCLING_IDLE_MS = 90_000;

/**
 * Mount once, from RibbonGlobalRow: two mounts is two catalogue fetches and two
 * competing cycle registrations. `isLidarBackground` is not "LiDAR is the ground
 * being read" — Terreng covers the background without replacing it, so the flag
 * stays true underneath.
 */
export const useLidarControls = () => {
  const map = useAtomValue(mapAtom);
  const [backgroundLayer, setBackgroundLayer] = useAtom(backgroundLayerAtom);
  const [hybridOverlay, setHybridOverlay] = useAtom(hybridOverlayAtom);
  // Contours ride on the Hybrid overlay, not on the dataset.
  const [hybridContours, setHybridContours] = useAtom(hybridContoursAtom);
  const [activeLidarProject, setActiveLidarProject] = useAtom(
    activeLidarProjectAtom,
  );
  const [activeLidarStyle, setActiveLidarStyle] = useAtom(activeLidarStyleAtom);
  const [lidarModel, setLidarModel] = useAtom(activeLidarModelAtom);
  // Follows the viewport unless pinned; the rules are lidarAuto.ts.
  const [autoDataset, setAutoDataset] = useAtom(lidarAutoDatasetAtom);

  // An atom because lidarFootprintsLayer draws footprints only while open.
  const [pickerOpen, setPickerOpen] = useAtom(lidarPickerOpenAtom);
  const setHoveredProjectId = useSetAtom(hoveredLidarProjectIdAtom);

  // Fetched in lidarFootprintsLayer, so pulldown and map share one WFS call.
  const viewport = useAtomValue(lidarViewportAtom);
  const [cycling, setCycling] = useAtom(lidarCyclingAtom);
  const cyclingTimerRef = useRef<number | undefined>(undefined);

  const [allProjects, setAllProjects] = useState<LidarProject[] | null>(null);
  const [nationalStyles, setNationalStyles] = useState<string[]>([]);

  // The full catalogue: ~1900 rows of GetCapabilities, cached in localStorage
  // for a week by fetchLidarProjects, and only used for the badge count below.
  useEffect(() => {
    let cancelled = false;
    fetchLidarProjects()
      .then((projects) => {
        if (!cancelled) setAllProjects(projects);
      })
      .catch((err) => {
        console.warn('[lidar] fetchLidarProjects failed', err);
        if (!cancelled) setAllProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The national mosaic's styles; a project's are already in the catalogue.
  useEffect(() => {
    let cancelled = false;
    fetchNationalLidarStyles()
      .then((styles) => {
        if (!cancelled) setNationalStyles(styles);
      })
      .catch(() => {
        if (!cancelled) setNationalStyles([DEFAULT_LIDAR_PROJECT_STYLE]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Envelope intersection, so no network — often a 3× overshoot on a
  // county-sized acquisition whose polygon misses the screen.
  const [envelopeCount, setEnvelopeCount] = useState(0);
  // Polygon-confirmed, kept after the pulldown closes so the badge does not
  // fall back to the estimate as soon as the user picks something.
  const [confirmedCount, setConfirmedCount] = useState<number | null>(null);
  useEffect(() => {
    if (!allProjects) return;
    const recompute = () => {
      const size = map.getSize();
      const center = map.getView().getCenter();
      if (!size || !center) return;
      const extent = map.getView().calculateExtent(size);
      const projection = map.getView().getProjection().getCode();
      const extentLonLat = transformExtent(extent, projection, 'EPSG:4326') as
        | [number, number, number, number]
        | undefined;
      if (!extentLonLat) return;
      setEnvelopeCount(
        allProjects.filter((p) => bboxIntersects(p.bboxLonLat, extentLonLat))
          .length,
      );
      setConfirmedCount(null);
    };
    recompute();
    map.on('moveend', recompute);
    return () => {
      map.un('moveend', recompute);
    };
  }, [allProjects, map]);

  useEffect(() => {
    if (viewport.status !== 'ready') return;
    setConfirmedCount(viewport.primary.length + viewport.secondary.length);
  }, [viewport]);

  const datasetCount = confirmedCount ?? envelopeCount;

  const isLidarProject = backgroundLayer === 'lidarProject';
  const isNationalMosaic = backgroundLayer === 'lidarHillshade';
  const isLidarBackground = isLidarProject || isNationalMosaic;

  // Metres per pixel (the view is EPSG:25833), the unit the auto rules use.
  // State rather than read on demand, so the resolver re-runs on a bare zoom.
  const [resolution, setResolution] = useState<number | null>(null);
  useEffect(() => {
    const read = () => setResolution(map.getView().getResolution() ?? null);
    read();
    map.on('moveend', read);
    return () => {
      map.un('moveend', read);
    };
  }, [map]);

  // Every dataset change goes through these two, because both clamp the style to
  // what the target publishes: the mosaic has only skyggerelieff, so carrying
  // helning_prosent over from a project renders an empty background. Neither
  // pins — that is the caller's call.
  const selectNational = useCallback(() => {
    setBackgroundLayer('lidarHillshade');
    setActiveLidarStyle((prev) => resolveLidarStyle(nationalStyles, prev));
  }, [nationalStyles, setBackgroundLayer, setActiveLidarStyle]);
  const selectProject = useCallback(
    (p: LidarProject) => {
      setActiveLidarProject(p);
      setBackgroundLayer('lidarProject');
      setActiveLidarStyle((prev) => resolveLidarStyle(p.styles, prev));
    },
    [setActiveLidarProject, setBackgroundLayer, setActiveLidarStyle],
  );

  // A row click picks and dismisses; the keyboard path below picks without
  // closing. Both are the user speaking, so both pin.
  const activateNational = () => {
    setAutoDataset(false);
    selectNational();
    setPickerOpen(false);
  };
  const activateProject = (p: LidarProject) => {
    setAutoDataset(false);
    selectProject(p);
    setPickerOpen(false);
  };
  const activateAuto = () => {
    setAutoDataset(true);
    // `current: null` so the resolver cannot inherit the pin as an incumbent
    // and leave Automatisk looking like it did nothing.
    const choice = chooseAutoDataset({ resolution, viewport, current: null });
    if (choice.kind === 'national') selectNational();
    else if (choice.kind === 'project') selectProject(choice.project);
    setPickerOpen(false);
  };

  // Not a dataset pick, so it must not pin. With auto on the dataset is chosen
  // up front rather than left to the resolver: landing on the mosaic first is
  // two screenfuls of WMS requests for one keypress.
  const enterLidar = () => {
    const choice = autoDataset
      ? chooseAutoDataset({ resolution, viewport, current: null })
      : ({ kind: 'hold' } as const);
    if (choice.kind === 'project') selectProject(choice.project);
    else selectNational();
  };

  // The Automatisk resolver: re-decides on every move and coverage change. It
  // cannot loop — every branch compares against what is showing before writing,
  // so the pass its own write triggers finds the dataset it asked for and stops.
  useEffect(() => {
    if (!isLidarBackground || !autoDataset) return;
    const choice = chooseAutoDataset({
      resolution,
      viewport,
      current: isLidarProject ? activeLidarProject : null,
    });
    if (choice.kind === 'national') {
      if (!isNationalMosaic) selectNational();
    } else if (choice.kind === 'project') {
      if (!isLidarProject || activeLidarProject?.id !== choice.project.id) {
        selectProject(choice.project);
      }
    }
  }, [
    isLidarBackground,
    autoDataset,
    resolution,
    viewport,
    isLidarProject,
    isNationalMosaic,
    activeLidarProject,
    selectNational,
    selectProject,
  ]);

  // Called by useGroundMode: unmounting the pulldown never fires its open-change
  // callback, so the shared flag has to be cleared by hand or the map keeps
  // drawing footprints over some other ground.
  const standDown = useCallback(() => {
    setPickerOpen(false);
    window.clearTimeout(cyclingTimerRef.current);
    setCycling(false);
  }, [setPickerOpen, setCycling]);

  // Collapses to one style in DOM mode, which takes the style pulldown off the
  // bar entirely — as the national DTM mosaic, with its single style, does.
  const datasetStyles = stylesForModel(
    isLidarProject && activeLidarProject
      ? activeLidarProject.styles
      : nationalStyles,
    lidarModel,
  );
  const tierAStyles = TIER_A_STYLES.filter((s) => datasetStyles.includes(s));
  const tierBStyles = datasetStyles.filter((s) => !TIER_A_STYLES.includes(s));
  // In DOM mode the model's own style, not the DTM pick being held for later.
  const shownStyle = effectiveLidarStyle(activeLidarStyle, lidarModel);

  // What `Behold` stitches. Null while the national style list is in flight: a
  // source advertising no styles would let a stitch ask for one it does not
  // publish.
  const activeLidarSource = useMemo((): LidarSource | null => {
    if (isLidarProject && activeLidarProject) {
      return projectLidarSource(activeLidarProject, lidarModel);
    }
    if (nationalStyles.length === 0) return null;
    return nationalLidarSource(nationalStyles, lidarModel);
  }, [isLidarProject, activeLidarProject, nationalStyles, lidarModel]);

  const cyclingPending =
    cycling && (viewport.status === 'loading' || viewport.status === 'idle');

  // Keeps the viewport list warm for W/S without opening the pulldown (which
  // would paint footprints). Expires, or every later moveend refetches the WFS.
  const armCycling = () => {
    setCycling(true);
    window.clearTimeout(cyclingTimerRef.current);
    cyclingTimerRef.current = window.setTimeout(
      () => setCycling(false),
      CYCLING_IDLE_MS,
    );
  };

  // A/D styles, W/S datasets, E model. Dispatched by useGroundMode, so no mode
  // check here; keys this ring cannot use are declined rather than swallowed.
  const cycle = (key: CycleKey): boolean => {
    if (key === 'e') {
      setLidarModel((prev) => (prev === 'dtm' ? 'dom' : 'dtm'));
      return true;
    }

    const step = key === 'd' || key === 's' ? 1 : -1;

    if (key === 'a' || key === 'd') {
      // DOM has one style: walking would overwrite the held DTM style for
      // no visible change.
      if (lidarModel === 'dom') return false;
      if (tierAStyles.length === 0) return false;
      const at = tierAStyles.indexOf(activeLidarStyle);
      // A "flere stiler" pick is off this ring: enter from the end the key
      // is heading towards.
      const from = at >= 0 ? at : step > 0 ? -1 : 0;
      setActiveLidarStyle(
        tierAStyles[(from + step + tierAStyles.length) % tierAStyles.length],
      );
      return true;
    }

    // The viewport list is only fetched while something asks for it, so the
    // first press after a pause fetches and the next one walks: cycling against
    // an unready list would silently pin the selection to the national mosaic.
    armCycling();
    if (viewport.status !== 'ready') return true;

    // Index 0 is the national mosaic, then the primary projects in pulldown
    // order.
    const entries = viewport.primary;
    const ring = entries.length + 1;
    const at = entries.findIndex((e) => e.project.id === activeLidarProject?.id);
    const from = isNationalMosaic ? 0 : at >= 0 ? at + 1 : step > 0 ? -1 : 0;
    const next = (from + step + ring) % ring;
    // Walking pins, or the resolver takes the background back on the next pan.
    setAutoDataset(false);
    if (next === 0) selectNational();
    else selectProject(entries[next - 1].project);
    return true;
  };

  return {
    cycle,
    hybridOverlay,
    setHybridOverlay,
    hybridContours,
    setHybridContours,
    isLidarBackground,
    isLidarProject,
    isNationalMosaic,
    enterLidar,
    standDown,
    activeLidarProject,
    allProjects,
    viewport,
    datasetCount,
    cyclingPending,
    pickerOpen,
    setPickerOpen,
    setHoveredProjectId,
    activateNational,
    activateProject,
    autoDataset,
    activateAuto,
    datasetStyles,
    tierAStyles,
    tierBStyles,
    shownStyle,
    setActiveLidarStyle,
    activeLidarSource,
    lidarModel,
    setLidarModel,
  };
};

export type LidarControls = ReturnType<typeof useLidarControls>;
