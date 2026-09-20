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
  cvatFor,
  fetchCvatStore,
  resolveCvatAcquisitions,
  stylesForFlight,
} from '../../map/layers/config/backgroundLayers/cvatGround';
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
  lidarFlightGround,
  type LidarModel,
  type LidarProject,
  preferredLidarRender,
  resolveLidarStyle,
  stylesForModel,
  TIER_A_STYLES,
  wmsLidarStyle,
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
  // The cached render of the flight above, or null where the store has none.
  // Written only beside it, by `selectProject`.
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

  const isNationalMosaic = backgroundLayer === 'lidarHillshade';
  // The two names one flight can be drawn under: Kartverket's WMS rendered it,
  // or we did and the tiles are on our own disk. Both are the same dataset.
  const isLidarProject = backgroundLayer === 'lidarProject';
  const isLidarCvat = backgroundLayer === 'lidarCvat';
  const isLidarFlight = isLidarProject || isLidarCvat;
  const isLidarBackground = isLidarFlight || isNationalMosaic;

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

  // Every dataset change goes through these two, because both clamp the render
  // to what the target offers: the mosaic has only skyggerelieff, so carrying
  // helning_prosent over from a flight renders an empty background, and
  // carrying `cvat` onto a flight the store does not hold renders nothing at
  // all. Neither pins — that is the caller's call.
  //
  // They are also the only writers of the layer name, which is why the render
  // is resolved here rather than left to the style picker: the name says which
  // of a flight's two renders is drawing, so it cannot be settled before the
  // render is.
  // `wanted` is for recreating a saved View, which has to come back on the
  // render it recorded: given one, the clamp is exact and the cache does not
  // claim a ground the View was not read on. Left out, the held render carries
  // over and `preferredLidarRender` applies its one upgrade.
  const selectNational = useCallback(
    (wanted?: string) => {
      setActiveLidarStyle(
        resolveLidarStyle(nationalStyles, wanted ?? activeLidarStyle),
      );
      setBackgroundLayer('lidarHillshade');
    },
    [nationalStyles, activeLidarStyle, setBackgroundLayer, setActiveLidarStyle],
  );
  const selectProject = useCallback(
    (p: LidarProject, wanted?: string) => {
      // The acquisition travels with the flight, so the two can never disagree
      // and nothing downstream has to ask whether they do.
      const cached = cvatFor(cvatAcquisitions, p);
      const offered = stylesForFlight(p, cached);
      const style =
        wanted != null
          ? resolveLidarStyle(offered, wanted)
          : preferredLidarRender(offered, activeLidarStyle);
      setActiveLidarProject(p);
      setActiveCvat(cached);
      setActiveLidarStyle(style);
      setBackgroundLayer(lidarFlightGround(style, lidarModel));
    },
    [
      cvatAcquisitions,
      activeLidarStyle,
      lidarModel,
      setActiveLidarProject,
      setActiveCvat,
      setActiveLidarStyle,
      setBackgroundLayer,
    ],
  );

  // The two render-tier writers. Both re-name the ground, because on a flight
  // the name is a function of the render: picking `cvat` moves to the cached
  // tiles and picking anything else moves back to the WMS, and DOM does the
  // same by way of `effectiveLidarStyle`. On the mosaic there is nothing to
  // re-name.
  const selectStyle = useCallback(
    (style: string) => {
      setActiveLidarStyle(style);
      if (isLidarFlight) {
        setBackgroundLayer(lidarFlightGround(style, lidarModel));
      }
    },
    [isLidarFlight, lidarModel, setActiveLidarStyle, setBackgroundLayer],
  );
  const selectModel = useCallback(
    (model: LidarModel) => {
      setLidarModel(model);
      if (isLidarFlight) {
        setBackgroundLayer(lidarFlightGround(activeLidarStyle, model));
      }
    },
    [isLidarFlight, activeLidarStyle, setLidarModel, setBackgroundLayer],
  );

  // A row click picks and dismisses; the keyboard path below picks without
  // closing. Both are the user speaking, so both pin.
  const activateNational = (wanted?: string) => {
    setAutoDataset(false);
    selectNational(wanted);
    setPickerOpen(false);
  };
  const activateProject = (p: LidarProject, wanted?: string) => {
    setAutoDataset(false);
    selectProject(p, wanted);
    setPickerOpen(false);
  };
  const activateAuto = () => {
    setAutoDataset(true);
    // A null incumbent so the resolver cannot inherit the pin and leave
    // Automatisk looking like it did nothing.
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
      // The mosaic leaves `activeLidarProject` holding the last flight, so the
      // incumbent is only an incumbent while a flight is the ground.
      current: isLidarFlight ? activeLidarProject : null,
    });
    if (choice.kind === 'national') {
      if (!isNationalMosaic) selectNational();
    } else if (choice.kind === 'project') {
      if (!isLidarFlight || activeLidarProject?.id !== choice.project.id) {
        selectProject(choice.project);
      }
    }
  }, [
    isLidarBackground,
    autoDataset,
    resolution,
    viewport,
    isLidarFlight,
    isNationalMosaic,
    activeLidarProject,
    selectNational,
    selectProject,
  ]);

  // A shared `?backgroundLayer=lidarCvat` names the ground but not the flight,
  // so it arrives with none and draws nothing for a tick. Nothing extra is
  // needed to fill it in: Automatisk is on at every cold load, the resolver
  // above names the flight as soon as the footprints land, and
  // `resolveLidarStyle` puts the render back on the cache where the store has
  // it. Where it does not, the link resolves to the flight's WMS, which is the
  // honest answer rather than a blank.

  // Called by useGroundMode: unmounting the pulldown never fires its open-change
  // callback, so the shared flag has to be cleared by hand or the map keeps
  // drawing footprints over some other ground.
  const standDown = useCallback(() => {
    setPickerOpen(false);
    window.clearTimeout(cyclingTimerRef.current);
    setCycling(false);
  }, [setPickerOpen, setCycling]);

  // The renders on offer for the ground: a flight's WMS styles, our cache ahead
  // of them where the store holds that flight, or the mosaic's one style.
  // Collapses to one in DOM mode — which takes the style pulldown off the bar
  // entirely, and takes the cache with it, since it was computed from terrain.
  const datasetStyles = stylesForModel(
    isLidarFlight && activeLidarProject
      ? stylesForFlight(activeLidarProject, activeCvat)
      : nationalStyles,
    lidarModel,
  );
  const tierAStyles = TIER_A_STYLES.filter((s) => datasetStyles.includes(s));
  const tierBStyles = datasetStyles.filter((s) => !TIER_A_STYLES.includes(s));
  // In DOM mode the model's own style, not the DTM pick being held for later.
  const shownStyle = effectiveLidarStyle(activeLidarStyle, lidarModel);

  // What `Behold` stitches: always a WMS, since the cache is a tile store with
  // no service behind it. Over a cached render that is the same flight's own
  // WMS — the catalogue row the cache was computed from — asked for the plain
  // hillshade by `wmsLidarStyle`, which is the nearest thing upstream has to
  // what is on screen. Null while the national style list is in flight: a
  // source advertising no styles would let a stitch ask for one it does not
  // publish.
  const activeLidarSource = useMemo((): LidarSource | null => {
    if (isLidarFlight && activeLidarProject) {
      return projectLidarSource(activeLidarProject, lidarModel);
    }
    if (nationalStyles.length === 0) return null;
    return nationalLidarSource(nationalStyles, lidarModel);
  }, [isLidarFlight, activeLidarProject, nationalStyles, lidarModel]);

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
      // Off a cached render this lands on the flight's DOM WMS, which is the
      // honest answer: the cache was computed from terrain and has no surface
      // twin. `selectModel` re-names the ground for it.
      selectModel(lidarModel === 'dtm' ? 'dom' : 'dtm');
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
      selectStyle(
        tierAStyles[(from + step + tierAStyles.length) % tierAStyles.length],
      );
      return true;
    }

    // The viewport list is only fetched while something asks for it, so the
    // first press after a pause fetches and the next one walks: cycling against
    // an unready list would silently pin the selection to the national mosaic.
    armCycling();
    if (viewport.status !== 'ready') return true;

    // Pulldown order: the national mosaic, then the primary flights. One stop
    // per flight — the cached render of one is on the A/D ring, not this one.
    const entries = viewport.primary;
    const ring = entries.length + 1;
    const at = isLidarFlight
      ? entries.findIndex((e) => e.project.id === activeLidarProject?.id)
      : -1;
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
    isNationalMosaic,
    isLidarCvat,
    isLidarFlight,
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
    // The render-tier writers. Named for what they are rather than for the
    // atoms they touch: each also re-names the ground, and a caller reaching
    // past them for the raw setter would leave the two disagreeing.
    setActiveLidarStyle: selectStyle,
    stitchStyle: wmsLidarStyle(shownStyle),
    activeLidarSource,
    lidarModel,
    setLidarModel: selectModel,
  };
};

export type LidarControls = ReturnType<typeof useLidarControls>;
