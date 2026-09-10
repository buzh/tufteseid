import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useEffect, useRef, useState } from 'react';
import { lidarExtractViewerOpenAtom } from '../../lidarExtract/atoms';
import { mapAtom } from '../../map/atoms';
import {
  backgroundLayerAtom,
  hybridOverlayAtom,
} from '../../map/layers/config/backgroundLayers/atoms';
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
 * Everything the LiDAR controls in the ribbon share: which dataset and style
 * are active, what the viewport has to offer, and the A/D/W/S/E behaviour.
 *
 * One hook rather than one per control, because the pieces are not
 * separable. Picking a dataset has to clamp the style; the style ring the
 * keyboard walks is derived from the dataset *and* the model; and the count
 * badge on the dataset chip is a fact about the viewport list the pulldown
 * also renders. Splitting them would mean the same three atoms read in four
 * components and the cycle handler closing over state it does not own.
 *
 * Mount once, from RibbonGlobalRow. Two mounts means two catalogue fetches
 * and two competing cycle registrations.
 *
 * `cycle` is returned rather than registered here: flyfoto mode has a ring
 * of its own and there is only ever one registered handler, so the ribbon
 * chains the two.
 */
export const useLidarControls = () => {
  const map = useAtomValue(mapAtom);
  const [backgroundLayer, setBackgroundLayer] = useAtom(backgroundLayerAtom);
  const [hybridOverlay, setHybridOverlay] = useAtom(hybridOverlayAtom);
  const [activeLidarProject, setActiveLidarProject] = useAtom(
    activeLidarProjectAtom,
  );
  const [activeLidarStyle, setActiveLidarStyle] = useAtom(activeLidarStyleAtom);
  const [lidarModel, setLidarModel] = useAtom(activeLidarModelAtom);

  // Shared, not local state: the map-side footprint overlay is drawn only
  // while this pulldown is open, and only for the row under the pointer
  // (see lidarFootprintsLayer).
  const [pickerOpen, setPickerOpen] = useAtom(lidarPickerOpenAtom);
  const setHoveredProjectId = useSetAtom(hoveredLidarProjectIdAtom);

  // Coverage-confirmed, tiered, capped viewport data — fetched once in
  // lidarFootprintsLayer (mounted by the shell) and shared with the map
  // footprint overlay so both read off a single WFS call.
  const viewport = useAtomValue(lidarViewportAtom);
  const [cycling, setCycling] = useAtom(lidarCyclingAtom);
  const cyclingTimerRef = useRef<number | undefined>(undefined);
  const extractViewerOpen = useAtomValue(lidarExtractViewerOpenAtom);

  const [allProjects, setAllProjects] = useState<LidarProject[] | null>(null);
  const [nationalStyles, setNationalStyles] = useState<string[]>([]);

  // Fetch the full LiDAR project catalogue once (WMS GetCapabilities, ~1900
  // rows, cached in localStorage for a week by fetchLidarProjects itself) —
  // feeds the cheap, always-on badge count below. The viewport-scoped,
  // coverage-confirmed list shown inside the pulldown comes from
  // lidarViewportAtom instead.
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

  // Style options for the national mosaic (per-project styles come from
  // activeLidarProject.styles directly, already in the catalogue).
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

  // Upper bound on how many datasets cover the viewport: catalogued projects
  // whose *envelope* intersects it. Cheap (pure array filter over the
  // already-loaded catalogue, no network), so it keeps running even outside
  // LiDAR mode — a number is then ready the instant the pulldown appears. It
  // overshoots, often by 3× in a town where a county-sized acquisition's
  // envelope reaches across the screen but its polygon doesn't; the count
  // below prefers the real, polygon-confirmed number as soon as the viewport
  // list has been fetched.
  const [envelopeCount, setEnvelopeCount] = useState(0);
  // The coverage-confirmed count, kept after the pulldown closes so the badge
  // doesn't jump back to the estimate the moment the user picks something.
  // Only the viewport list can produce it, and that's only fetched while the
  // pulldown is open or W/S cycling is armed.
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
      // A confirmed count belongs to the view it was counted in.
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

  // Prefer the confirmed count; fall back to the envelope estimate, where
  // overshooting is the right way to be wrong for a "there is something
  // here" hint.
  const datasetCount = confirmedCount ?? envelopeCount;

  const isLidarProject = backgroundLayer === 'lidarProject';
  const isNationalMosaic = backgroundLayer === 'lidarHillshade';
  const isLidarMode = isLidarProject || isNationalMosaic;

  // Both activation paths clamp the style to what the target dataset
  // actually publishes (see resolveLidarStyle) — the national mosaic
  // publishes only skyggerelieff, so carrying e.g. helning_prosent over from
  // a project would render an empty background.
  const selectNational = () => {
    setBackgroundLayer('lidarHillshade');
    setActiveLidarStyle((prev) => resolveLidarStyle(nationalStyles, prev));
  };
  const selectProject = (p: LidarProject) => {
    setActiveLidarProject(p);
    setBackgroundLayer('lidarProject');
    setActiveLidarStyle((prev) => resolveLidarStyle(p.styles, prev));
  };
  // Clicking a row picks *and* dismisses; the keyboard path below picks
  // without closing, so you can watch the selection walk the open list.
  const activateNational = () => {
    selectNational();
    setPickerOpen(false);
  };
  const activateProject = (p: LidarProject) => {
    selectProject(p);
    setPickerOpen(false);
  };

  // Leaving LiDAR mode unmounts the pulldown without it ever firing its
  // open-change callback, so clear the shared flag by hand — otherwise the
  // map would draw footprints again the next time LiDAR is switched on. Same
  // for the cycling flag: no LiDAR background, nothing to cycle, so stop
  // paying for the footprint fetch.
  useEffect(() => {
    if (isLidarMode) return;
    setPickerOpen(false);
    window.clearTimeout(cyclingTimerRef.current);
    setCycling(false);
  }, [isLidarMode, setPickerOpen, setCycling]);

  // In DOM mode this collapses to a single style, which takes the style
  // pulldown off the bar entirely — same as the national DTM mosaic, which
  // has only ever published the one.
  const datasetStyles = stylesForModel(
    isLidarProject && activeLidarProject
      ? activeLidarProject.styles
      : nationalStyles,
    lidarModel,
  );
  const tierAStyles = TIER_A_STYLES.filter((s) => datasetStyles.includes(s));
  const tierBStyles = datasetStyles.filter((s) => !TIER_A_STYLES.includes(s));
  // What the pulldown should present as selected, which in DOM mode is the
  // model's own style rather than the DTM pick being held for later.
  const shownStyle = effectiveLidarStyle(activeLidarStyle, lidarModel);

  // Armed by a keypress, list not back yet — 'idle' covers the tick between
  // arming and the fetch effect starting.
  const cyclingPending =
    cycling && (viewport.status === 'loading' || viewport.status === 'idle');

  // Keeps the viewport list warm for W/S without opening the pulldown —
  // opening it is what paints footprint polygons on the map, and the point
  // of cycling from the keyboard is to keep the terrain clean. Expires on
  // idle so panning around minutes after the last keypress doesn't keep the
  // footprint WFS refetching on every moveend.
  const armCycling = () => {
    setCycling(true);
    window.clearTimeout(cyclingTimerRef.current);
    cyclingTimerRef.current = window.setTimeout(
      () => setCycling(false),
      CYCLING_IDLE_MS,
    );
  };

  // Keyboard cycling (A/D styles, W/S datasets, E model) —
  // docs/ui-architecture.md §5.3. The document listener itself lives in
  // useBackgroundCyclingKeys, mounted at the shell root; this is only the
  // behaviour, handed to the ribbon to register. Every key is declined
  // outside LiDAR mode so another mode's handler can have it.
  const cycle = (key: CycleKey): boolean => {
    // The extract viewer covers the map: swapping the background behind it
    // would be invisible and still cost a full round of WMS loads.
    if (!isLidarMode || extractViewerOpen) return false;

    if (key === 'e') {
      setLidarModel((prev) => (prev === 'dtm' ? 'dom' : 'dtm'));
      return true;
    }

    const step = key === 'd' || key === 's' ? 1 : -1;

    if (key === 'a' || key === 'd') {
      // DOM has one style. Walking a one-entry ring would overwrite the DTM
      // style being held for the trip back, for no visible change.
      if (lidarModel === 'dom') return false;
      if (tierAStyles.length === 0) return false;
      const at = tierAStyles.indexOf(activeLidarStyle);
      // A "flere stiler" entry is active and so isn't on this ring — enter
      // the ring from whichever end the key is heading towards.
      const from = at >= 0 ? at : step > 0 ? -1 : 0;
      setActiveLidarStyle(
        tierAStyles[(from + step + tierAStyles.length) % tierAStyles.length],
      );
      return true;
    }

    // The project ring is the same viewport list the pulldown shows, and
    // that list is only kept current while something asks for it (see
    // lidarFootprintsLayer — the footprint WFS is expensive enough that it
    // isn't run for the whole LiDAR session). Arming the cycling flag starts
    // it without opening the pulldown or drawing footprints, so the first
    // press after a pause is a no-op that fetches and the next one walks the
    // list. Cycling against an empty list would silently pin the selection
    // to the national mosaic.
    armCycling();
    if (viewport.status !== 'ready') return true;

    // Index 0 is the national mosaic, then the primary projects — same order
    // the pulldown lists them in.
    const entries = viewport.primary;
    const ring = entries.length + 1;
    const at = entries.findIndex((e) => e.project.id === activeLidarProject?.id);
    const from = isNationalMosaic ? 0 : at >= 0 ? at + 1 : step > 0 ? -1 : 0;
    const next = (from + step + ring) % ring;
    if (next === 0) selectNational();
    else selectProject(entries[next - 1].project);
    return true;
  };

  return {
    // Keyboard
    cycle,
    // Mode
    backgroundLayer,
    setBackgroundLayer,
    hybridOverlay,
    setHybridOverlay,
    isLidarMode,
    isLidarProject,
    isNationalMosaic,
    // Dataset
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
    // Style
    datasetStyles,
    tierAStyles,
    tierBStyles,
    shownStyle,
    setActiveLidarStyle,
    // Model
    lidarModel,
    setLidarModel,
  };
};

export type LidarControls = ReturnType<typeof useLidarControls>;
