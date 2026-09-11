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
 * Everything here is scoped to **the LiDAR background being on**, which is not
 * the same question as "LiDAR is the ground the user is reading": Terreng
 * covers the background without replacing it, so `isLidarBackground` stays
 * true underneath it. Deciding whether these controls are on screen, or
 * whether the keys reach `cycle`, is therefore useGroundMode's job and not
 * this hook's — it cannot see Terreng from here.
 */
export const useLidarControls = () => {
  const map = useAtomValue(mapAtom);
  const [backgroundLayer, setBackgroundLayer] = useAtom(backgroundLayerAtom);
  const [hybridOverlay, setHybridOverlay] = useAtom(hybridOverlayAtom);
  // Contours ride on that overlay, so they live with it rather than with the
  // dataset — see the atom for why they are a modifier on a modifier.
  const [hybridContours, setHybridContours] = useAtom(hybridContoursAtom);
  const [activeLidarProject, setActiveLidarProject] = useAtom(
    activeLidarProjectAtom,
  );
  const [activeLidarStyle, setActiveLidarStyle] = useAtom(activeLidarStyleAtom);
  const [lidarModel, setLidarModel] = useAtom(activeLidarModelAtom);
  // Whether the dataset follows the viewport rather than staying where the
  // user put it. See lidarAuto.ts for the rules; the resolver effect is
  // below, next to the two selectors it drives.
  const [autoDataset, setAutoDataset] = useAtom(lidarAutoDatasetAtom);

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
  const isLidarBackground = isLidarProject || isNationalMosaic;

  // Map view resolution in metres per pixel — what the auto rules are
  // expressed in, since the view is EPSG:25833 and the thresholds are about
  // the source grids rather than about window size. Tracked as state rather
  // than read on demand so the resolver effect re-runs when the user zooms
  // without also panning.
  const [resolution, setResolution] = useState<number | null>(null);
  useEffect(() => {
    const read = () => setResolution(map.getView().getResolution() ?? null);
    read();
    map.on('moveend', read);
    return () => {
      map.un('moveend', read);
    };
  }, [map]);

  // Every path that changes the dataset goes through these two — the
  // pulldown, the keyboard ring and the auto resolver alike — because both
  // clamp the style to what the target dataset actually publishes (see
  // resolveLidarStyle). The national mosaic publishes only skyggerelieff,
  // so carrying e.g. helning_prosent over from a project would render an
  // empty background.
  //
  // Neither touches autoDataset. Whether a selection counts as the user
  // pinning something is the caller's business, not the selector's: the
  // resolver drives these all day without the dataset ever stopping being
  // automatic.
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

  // Clicking a row picks *and* dismisses; the keyboard path below picks
  // without closing, so you can watch the selection walk the open list.
  // Both are the user speaking, so both pin.
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
    // Decide afresh instead of letting the resolver inherit the pin. The
    // stickiness that keeps the background calm while panning would
    // otherwise read the pinned dataset as an incumbent worth keeping, and
    // pressing "Automatisk" would look like it did nothing — when what the
    // user asked for is precisely "give me the best one for here".
    const choice = chooseAutoDataset({ resolution, viewport, current: null });
    if (choice.kind === 'national') selectNational();
    else if (choice.kind === 'project') selectProject(choice.project);
    setPickerOpen(false);
  };

  // Switching *into* LiDAR mode from the ribbon. Not a dataset pick, so it
  // must not pin — it only has to put something on screen for the mode to be
  // about. With auto on that is the best dataset for the current view, chosen
  // up front rather than by landing on the mosaic and letting the resolver
  // correct it a beat later: two swaps in a row is two screenfuls of WMS
  // requests for one keypress. Anything the resolver isn't sure of yet
  // (coverage list still loading) starts on the mosaic, which always covers,
  // and gets refined when the list lands.
  const enterLidar = () => {
    const choice = autoDataset
      ? chooseAutoDataset({ resolution, viewport, current: null })
      : ({ kind: 'hold' } as const);
    if (choice.kind === 'project') selectProject(choice.project);
    else selectNational();
  };

  // The resolver. Re-decides whenever the view moves or the coverage list
  // changes, and writes through the same selectors the pulldown uses.
  //
  // It cannot loop: a 'hold' writes nothing, and the other two outcomes are
  // compared against what is already showing before anything is set. The
  // effect does re-run on its own writes — activeLidarProject is an input —
  // but the second pass finds the dataset it just asked for and stops.
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

  // Called by useGroundMode the moment LiDAR stops being the ground on
  // screen. It has to be pushed in from there rather than run off
  // isLidarBackground here, because the LiDAR stack stays loaded under a
  // terrain render and this is about the controls, not the layers.
  //
  // Taking the pulldown off the bar unmounts it without it ever firing its
  // open-change callback, so the shared flag is cleared by hand — otherwise
  // the map keeps drawing footprint polygons over ground the user is now
  // reading some other way. Same for the cycling flag: no ring to walk,
  // nothing worth keeping the footprint WFS warm for.
  const standDown = useCallback(() => {
    setPickerOpen(false);
    window.clearTimeout(cyclingTimerRef.current);
    setCycling(false);
  }, [setPickerOpen, setCycling]);

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

  /*
   * The same dataset, said in the extract tool's vocabulary — what `Behold`
   * stitches when the LiDAR ground is the one on screen
   * (docs/lokalitet-view.md §4.3).
   *
   * Built here rather than by re-enumerating from a bbox, because "which
   * dataset" is a question this hook has already answered: `Behold` keeps the
   * ground *you are looking at*, so going back to the catalogue could only
   * produce a different answer, and a different answer is the bug.
   *
   * Null while the national mosaic's style list is still in flight. It is
   * cached and normally instant, but a source advertising no styles at all
   * would let a stitch ask for one the service does not publish.
   */
  const activeLidarSource = useMemo((): LidarSource | null => {
    if (isLidarProject && activeLidarProject) {
      return projectLidarSource(activeLidarProject, lidarModel);
    }
    if (nationalStyles.length === 0) return null;
    return nationalLidarSource(nationalStyles, lidarModel);
  }, [isLidarProject, activeLidarProject, nationalStyles, lidarModel]);

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
  // behaviour, and it is reached only while LiDAR (or Hybrid) is the ground
  // on screen — useGroundMode dispatches, so there is no mode check here.
  // Keys this ring has no use for are still declined, so nothing else on the
  // page is robbed of them.
  const cycle = (key: CycleKey): boolean => {
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
    // Walking the ring is the user choosing a dataset just as much as
    // clicking a row is, so it pins. Otherwise the resolver would take the
    // background back on the next pan and W/S would feel broken.
    setAutoDataset(false);
    if (next === 0) selectNational();
    else selectProject(entries[next - 1].project);
    return true;
  };

  return {
    // Keyboard
    cycle,
    // Background, and being taken off the bar
    hybridOverlay,
    setHybridOverlay,
    hybridContours,
    setHybridContours,
    isLidarBackground,
    isLidarProject,
    isNationalMosaic,
    enterLidar,
    standDown,
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
    autoDataset,
    activateAuto,
    // Style
    datasetStyles,
    tierAStyles,
    tierBStyles,
    shownStyle,
    setActiveLidarStyle,
    // Dataset + style + model as one thing the stitcher can take
    activeLidarSource,
    // Model
    lidarModel,
    setLidarModel,
  };
};

export type LidarControls = ReturnType<typeof useLidarControls>;
