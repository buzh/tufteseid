// The LiDAR ring's controller: which flight is drawing, which render of it, and
// which model. Everything the ribbon does to the map goes through here, because
// the three are not independent — the ground's *name* is a function of the
// render, and a render is only on offer where the dataset publishes it.
//
// Mount once. Two mounts is two catalogue fetches and two Automatisk resolvers
// writing the same atoms.

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import { mapAtom } from '../map/atoms';
import { backgroundLayerAtom } from '../map/layers/config/backgroundLayers/atoms';
import {
  activeCvatAcquisitionAtom,
  type CvatAcquisition,
  cvatFor,
  fetchCvatStore,
  resolveCvatAcquisitions,
  stylesForFlight,
} from '../map/layers/config/backgroundLayers/cvatGround';
import {
  chooseAutoDataset,
  lidarAutoDatasetAtom,
} from '../map/layers/config/backgroundLayers/lidarAuto';
import {
  activeLidarModelAtom,
  activeLidarProjectAtom,
  activeLidarStyleAtom,
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
} from '../map/layers/config/backgroundLayers/lidarProjects';
import {
  hoveredLidarProjectIdAtom,
  lidarPickerOpenAtom,
  lidarViewportAtom,
} from '../map/layers/config/backgroundLayers/lidarRelevance';

export const useLidarControls = () => {
  const map = useAtomValue(mapAtom);
  const [backgroundLayer, setBackgroundLayer] = useAtom(backgroundLayerAtom);
  const [activeLidarProject, setActiveLidarProject] = useAtom(
    activeLidarProjectAtom,
  );
  const [activeLidarStyle, setActiveLidarStyle] = useAtom(activeLidarStyleAtom);
  // The cached render of the flight above, or null where the store has none.
  // Written only beside it, by `selectProject`, so the two cannot disagree.
  const [activeCvat, setActiveCvat] = useAtom(activeCvatAcquisitionAtom);
  const [lidarModel, setLidarModel] = useAtom(activeLidarModelAtom);
  // Follows the viewport unless pinned; the rules are `lidarAuto.ts`.
  const [autoDataset, setAutoDataset] = useAtom(lidarAutoDatasetAtom);

  // An atom because `lidarFootprintsLayer` paints footprints only while open.
  const [pickerOpen, setPickerOpen] = useAtom(lidarPickerOpenAtom);
  const setHoveredProjectId = useSetAtom(hoveredLidarProjectIdAtom);

  // Fetched by `lidarFootprintsLayer`, so the pulldown and the map share one
  // WFS pass over the viewport.
  const viewport = useAtomValue(lidarViewportAtom);

  // ~1900 rows of GetCapabilities, cached a week in localStorage by the fetcher.
  // Only the cVAT join below needs the whole catalogue; the picker's rows come
  // off the viewport.
  const [allProjects, setAllProjects] = useState<LidarProject[] | null>(null);
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

  // What the cVAT store holds, joined to the catalogue rows its acquisitions are
  // named after. Read from the manifest once per load rather than compiled in,
  // so a batch run that lands on the server is in the app on the next reload
  // with no deploy. Empty on an install without a store.
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

  // The national mosaic's styles; a flight's are already in the catalogue row.
  const [nationalStyles, setNationalStyles] = useState<string[]>([]);
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

  const isNationalMosaic = backgroundLayer === 'lidarHillshade';
  // The two names one flight can be drawn under: Kartverket's WMS rendered it,
  // or we did and the tiles are on our own disk. Both are the same dataset.
  const isLidarCvat = backgroundLayer === 'lidarCvat';
  const isLidarFlight = backgroundLayer === 'lidarProject' || isLidarCvat;
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
  // helning_prosent over from a flight renders an empty background, and carrying
  // `cvat` onto a flight the store does not hold renders nothing at all.
  // Neither pins — that is the caller's call.
  //
  // They are also the only writers of the layer name, which is why the render is
  // resolved here rather than in the render menu: the name says which of a
  // flight's two renders is drawing, so it cannot be settled before the render
  // is.
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
      // The acquisition travels with the flight, so nothing downstream has to
      // ask whether the two agree.
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
  // tiles and picking anything else moves back to the WMS, and DOM does the same
  // by way of `effectiveLidarStyle`. On the mosaic there is nothing to re-name.
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

  // A row click picks and dismisses. All three are the user speaking, so all
  // three pin — except Automatisk, which is the user handing the choice back.
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
    // A null incumbent so the resolver cannot inherit the pin and leave
    // Automatisk looking like it did nothing.
    const choice = chooseAutoDataset({ resolution, viewport, current: null });
    if (choice.kind === 'national') selectNational();
    else if (choice.kind === 'project') selectProject(choice.project);
    setPickerOpen(false);
  };

  // Not a dataset pick, so it must not pin. With auto on the dataset is chosen
  // up front rather than left to the resolver: landing on the mosaic first is
  // two screenfuls of WMS requests for one click.
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
  // `preferredLidarRender` puts the render back on the cache where the store has
  // it. Where it does not, the link resolves to the flight's WMS, which is the
  // honest answer rather than a blank.

  // `lidarPickerOpenAtom` is shared with the map, and an unmount never fires the
  // menu's own close callback — so the map would keep painting footprints over
  // whatever came next.
  useEffect(
    () => () => {
      setPickerOpen(false);
      setHoveredProjectId(null);
    },
    [setPickerOpen, setHoveredProjectId],
  );

  // The renders on offer for the ground: a flight's WMS styles, our cache ahead
  // of them where the store holds that flight, or the mosaic's one style.
  // Collapses to one in DOM mode, which takes the cache with it — it was
  // computed from terrain and has no surface twin.
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

  // Which of the flights on offer the store has a render of, so the picker can
  // say which rows carry one before they are chosen. Ids, because that is what
  // the join is on.
  const cachedFlightIds = new Set(cvatAcquisitions.map((a) => a.project.id));

  return {
    isLidarBackground,
    isNationalMosaic,
    isLidarFlight,
    isLidarCvat,
    enterLidar,

    // Dataset tier.
    activeLidarProject,
    activeCvat,
    cachedFlightIds,
    viewport,
    autoDataset,
    activateAuto,
    activateNational,
    activateProject,
    pickerOpen,
    setPickerOpen,
    setHoveredProjectId,

    // Render tier. Named for what they do rather than for the atoms they touch:
    // each also re-names the ground, and a caller reaching past them for the raw
    // setter would leave the two disagreeing.
    tierAStyles,
    tierBStyles,
    shownStyle,
    selectStyle,
    lidarModel,
    selectModel,
  };
};

export type LidarControls = ReturnType<typeof useLidarControls>;
