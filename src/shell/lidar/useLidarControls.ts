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
  activeCvatAcquisitionAtom,
  type CvatAcquisition,
  fetchCvatStore,
  resolveCvatAcquisitions,
} from '../../map/layers/config/backgroundLayers/cvatGround';
import {
  chooseAutoDataset,
  type LidarDataset,
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
  // Which cached acquisition the cached ground is showing.
  const [activeCvat, setActiveCvat] = useAtom(activeCvatAcquisitionAtom);
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

  // What the cVAT store holds, joined to the catalogue rows the acquisitions
  // are named after. Read once per load from the manifest rather than compiled
  // in, so a batch run that finishes on the server is in the app on the next
  // reload and needs no deploy. Empty on an install without a store.
  const [cvatAcquisitions, setCvatAcquisitions] = useState<CvatAcquisition[]>(
    [],
  );
  useEffect(() => {
    if (!allProjects) return;
    let cancelled = false;
    fetchCvatStore().then((store) => {
      if (!cancelled) {
        setCvatAcquisitions(resolveCvatAcquisitions(store, allProjects));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [allProjects]);

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
        [number, number, number, number] | undefined;
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
  // Our own precomputed ground: a dataset in the same ring, not a style.
  const isLidarCvat = backgroundLayer === 'lidarCvat';
  const isLidarBackground = isLidarProject || isNationalMosaic || isLidarCvat;

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
  // No style to clamp: the cache is one visualization, and leaving the held
  // style alone is what lets it survive the trip through the cached ground.
  // The acquisition is the pick, though — the store holds several, each its own
  // envelope and its own set of levels.
  const selectCvat = useCallback(
    (acquisition: CvatAcquisition) => {
      setActiveCvat(acquisition);
      setBackgroundLayer('lidarCvat');
    },
    [setActiveCvat, setBackgroundLayer],
  );

  // What the resolver's hysteresis is measured against: the ground drawing
  // now, not the acquisition atom, which keeps its last value under the mosaic.
  // Memoised because the resolver effect depends on it, and a fresh object per
  // render would re-decide on every keystroke anywhere in the app.
  const currentDataset = useMemo(
    (): LidarDataset =>
      isLidarCvat && activeCvat
        ? { kind: 'cvat', acquisition: activeCvat }
        : isLidarProject && activeLidarProject
          ? { kind: 'project', project: activeLidarProject }
          : { kind: 'national' },
    [isLidarCvat, activeCvat, isLidarProject, activeLidarProject],
  );

  // The cached acquisitions the viewport touches, in the order the project rows
  // are in. Both tiers, unlike the project list's own split: the cache is
  // scarce and deliberately built, so if any of it is on screen it is worth
  // offering, even at the sliver of coverage that demotes a project.
  const cvatEntries = useMemo(() => {
    if (viewport.status !== 'ready' || cvatAcquisitions.length === 0) return [];
    const byId = new Map(cvatAcquisitions.map((a) => [a.project.id, a]));
    return [...viewport.primary, ...viewport.secondary].flatMap((e) => {
      const acquisition = byId.get(e.project.id);
      return acquisition ? [{ acquisition, areaRatio: e.areaRatio }] : [];
    });
  }, [viewport, cvatAcquisitions]);

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
  const activateCvat = (acquisition: CvatAcquisition) => {
    setAutoDataset(false);
    selectCvat(acquisition);
    setPickerOpen(false);
  };
  const activateAuto = () => {
    setAutoDataset(true);
    // A national incumbent so the resolver cannot inherit the pin and leave
    // Automatisk looking like it did nothing.
    const choice = chooseAutoDataset({
      resolution,
      viewport,
      current: { kind: 'national' },
      cached: cvatAcquisitions,
    });
    if (choice.kind === 'national') selectNational();
    else if (choice.kind === 'project') selectProject(choice.project);
    else if (choice.kind === 'cvat') selectCvat(choice.acquisition);
    setPickerOpen(false);
  };

  // Not a dataset pick, so it must not pin. With auto on the dataset is chosen
  // up front rather than left to the resolver: landing on the mosaic first is
  // two screenfuls of WMS requests for one keypress.
  const enterLidar = () => {
    const choice = autoDataset
      ? chooseAutoDataset({
          resolution,
          viewport,
          current: { kind: 'national' },
          cached: cvatAcquisitions,
        })
      : ({ kind: 'hold' } as const);
    if (choice.kind === 'project') selectProject(choice.project);
    else if (choice.kind === 'cvat') selectCvat(choice.acquisition);
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
      current: currentDataset,
      cached: cvatAcquisitions,
    });
    if (choice.kind === 'national') {
      if (!isNationalMosaic) selectNational();
    } else if (choice.kind === 'project') {
      if (!isLidarProject || activeLidarProject?.id !== choice.project.id) {
        selectProject(choice.project);
      }
    } else if (choice.kind === 'cvat') {
      const showing =
        isLidarCvat && activeCvat?.project.id === choice.acquisition.project.id;
      if (!showing) selectCvat(choice.acquisition);
    }
  }, [
    isLidarBackground,
    autoDataset,
    resolution,
    viewport,
    cvatAcquisitions,
    isLidarProject,
    isNationalMosaic,
    isLidarCvat,
    activeLidarProject,
    activeCvat,
    currentDataset,
    selectNational,
    selectProject,
    selectCvat,
  ]);

  // A shared link names the layer, not the acquisition it was over, so a cold
  // load onto the cached ground arrives with none and draws nothing. Usually
  // the resolver above fills it in — but inside its hysteresis band it
  // deliberately decides nothing, and the layer would stay blank there. So take
  // the acquisition off the footprint ranking directly, and hand the ground
  // back to the mosaic when the ranking says none of the cache is on screen.
  useEffect(() => {
    if (!isLidarCvat || activeCvat) return;
    if (viewport.status === 'idle' || viewport.status === 'loading') return;
    // Only where the resolver has deliberately decided nothing. Both effects
    // run in the same pass off the same stale `activeCvat`, so anywhere the
    // resolver does have an answer this would be a second writer racing it.
    const holding =
      chooseAutoDataset({
        resolution,
        viewport,
        current: currentDataset,
        cached: cvatAcquisitions,
      }).kind === 'hold';
    if (autoDataset && !holding) return;
    const best = cvatEntries[0];
    if (best) selectCvat(best.acquisition);
    else selectNational();
  }, [
    isLidarCvat,
    activeCvat,
    autoDataset,
    resolution,
    viewport,
    currentDataset,
    cvatAcquisitions,
    cvatEntries,
    selectCvat,
    selectNational,
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
  // Empty on the cached ground, which is one DTM visualization and no choice.
  const datasetStyles = isLidarCvat
    ? []
    : stylesForModel(
        isLidarProject && activeLidarProject
          ? activeLidarProject.styles
          : nationalStyles,
        lidarModel,
      );
  const tierAStyles = TIER_A_STYLES.filter((s) => datasetStyles.includes(s));
  const tierBStyles = datasetStyles.filter((s) => !TIER_A_STYLES.includes(s));
  // In DOM mode the model's own style, not the DTM pick being held for later.
  // Skyggerelieff on the cached ground for the same reason: the style pulldown
  // is off the bar there, so a held `helning_prosent` would be an invisible
  // choice that `Behold` would silently stitch.
  const shownStyle = isLidarCvat
    ? DEFAULT_LIDAR_PROJECT_STYLE
    : effectiveLidarStyle(activeLidarStyle, lidarModel);

  // What `Behold` stitches. Null while the national style list is in flight: a
  // source advertising no styles would let a stitch ask for one it does not
  // publish.
  // Over the cached ground the stitch is of its acquisition, not of whatever
  // the mosaic would give back: the cache has no WMS behind it, but the
  // acquisition it was computed from is the catalogue row the cached ground
  // carries, so the stitch asks that project's WMS for the same ground.
  const activeLidarSource = useMemo((): LidarSource | null => {
    // DTM regardless of what is held, matching the faded fallback under it and
    // the cached pixels themselves.
    if (isLidarCvat) {
      return activeCvat ? projectLidarSource(activeCvat.project, 'dtm') : null;
    }
    if (isLidarProject && activeLidarProject) {
      return projectLidarSource(activeLidarProject, lidarModel);
    }
    if (nationalStyles.length === 0) return null;
    return nationalLidarSource(nationalStyles, lidarModel);
  }, [
    isLidarCvat,
    activeCvat,
    isLidarProject,
    activeLidarProject,
    nationalStyles,
    lidarModel,
  ]);

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
      // The cached ground is DTM and has no DOM twin, so the key would move
      // nothing but the faded mosaic under its holes.
      if (isLidarCvat) return false;
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

    // Pulldown order: the national mosaic, then whatever of the cache is on
    // screen — usually one acquisition and often none — then the primary
    // projects.
    const entries = viewport.primary;
    const FIXED = 1 + cvatEntries.length;
    const ring = entries.length + FIXED;
    const at = entries.findIndex(
      (e) => e.project.id === activeLidarProject?.id,
    );
    const cvatAt = isLidarCvat
      ? cvatEntries.findIndex(
          (e) => e.acquisition.project.id === activeCvat?.project.id,
        )
      : -1;
    const from = isNationalMosaic
      ? 0
      : cvatAt >= 0
        ? 1 + cvatAt
        : at >= 0
          ? at + FIXED
          : step > 0
            ? -1
            : 0;
    const next = (from + step + ring) % ring;
    // Walking pins, or the resolver takes the background back on the next pan.
    setAutoDataset(false);
    if (next === 0) selectNational();
    else if (next < FIXED) selectCvat(cvatEntries[next - 1].acquisition);
    else selectProject(entries[next - FIXED].project);
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
    isLidarCvat,
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
    activateCvat,
    cvatEntries,
    activeCvat,
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
