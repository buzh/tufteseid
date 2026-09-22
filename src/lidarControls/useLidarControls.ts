// The LiDAR ring's controller: which flight is drawing, which render of it, and
// which model. Everything the controls do to the map goes through here, because
// the three are not independent — the ground's *name* is a function of the
// render, and a render is only on offer where the dataset publishes it.
//
// One per half. Each writes its own side of every pair in
// `map/compare/halves.ts`, so the two panes of a two-ground view hold different
// flights, renders and models without knowing about each other, and each runs
// its own Automatisk resolver over its own dataset.
//
// What two mounts do cost is two copies of the placed cVAT store and the
// national style list in component state. The fetches behind both are cached at
// module level, so the network cost is paid once either way.

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import { mapAtom } from '../map/atoms';
import { viewportBbox } from '../map/bbox';
import type { CompareHalf } from '../map/compare/halves';
import { backgroundLayerHalves } from '../map/layers/config/backgroundLayers/atoms';
import {
  activeCvatAcquisitionHalves,
  type CvatAcquisition,
  cvatFor,
  fetchCvatAcquisitions,
  stylesForFlight,
} from '../map/layers/config/backgroundLayers/cvatGround';
import {
  chooseAutoDataset,
  lidarAutoDatasetHalves,
  pinnedFlightLeftBehind,
} from '../map/layers/config/backgroundLayers/lidarAuto';
import {
  activeLidarModelHalves,
  activeLidarProjectHalves,
  activeLidarStyleHalves,
  DEFAULT_LIDAR_PROJECT_STYLE,
  effectiveLidarStyle,
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
  lidarPickerOpenHalves,
  lidarViewportAtom,
} from '../map/layers/config/backgroundLayers/lidarRelevance';

export const useLidarControls = (half: CompareHalf) => {
  const map = useAtomValue(mapAtom);
  const [backgroundLayer, setBackgroundLayer] = useAtom(
    backgroundLayerHalves[half],
  );
  const [activeLidarProject, setActiveLidarProject] = useAtom(
    activeLidarProjectHalves[half],
  );
  const [activeLidarStyle, setActiveLidarStyle] = useAtom(
    activeLidarStyleHalves[half],
  );
  // The cached render of the flight above, or null where the store has none.
  // Written only beside it, by `selectProject`, so the two cannot disagree.
  const [activeCvat, setActiveCvat] = useAtom(activeCvatAcquisitionHalves[half]);
  const [lidarModel, setLidarModel] = useAtom(activeLidarModelHalves[half]);
  // Follows the viewport unless pinned; the rules are `lidarAuto.ts`.
  const [autoDataset, setAutoDataset] = useAtom(lidarAutoDatasetHalves[half]);

  // An atom because `lidarFootprintsLayer` paints footprints only while open.
  const [pickerOpen, setPickerOpen] = useAtom(lidarPickerOpenHalves[half]);
  const setHoveredProjectId = useSetAtom(hoveredLidarProjectIdAtom);

  // Fetched by `lidarFootprintsLayer`, so the pulldown and the map share one
  // WFS pass over the viewport.
  const viewport = useAtomValue(lidarViewportAtom);

  // What the cVAT store holds, placed — off the catalogue where it has a row
  // for the acquisition and off the manifest's own envelope where it has not.
  // Read at runtime rather than compiled in, so a batch run that lands on the
  // server is in the app on the next reload with no deploy. Empty on an install
  // without a store, and never a rejection: see `fetchCvatAcquisitions`.
  const [cvatAcquisitions, setCvatAcquisitions] = useState<CvatAcquisition[]>(
    [],
  );
  useEffect(() => {
    let cancelled = false;
    fetchCvatAcquisitions().then((held) => {
      if (!cancelled) setCvatAcquisitions(held);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
  //
  // Picking a render unpins the dataset too. Automatisk does not choose the
  // render, but it re-derives it on every dataset switch — `preferredLidarRender`
  // would move a deliberate skyggerelieff onto the cache the moment the next
  // flight has one. Having just said which picture they want, the reader should
  // keep it.
  const selectStyle = useCallback(
    (style: string) => {
      setAutoDataset(false);
      setActiveLidarStyle(style);
      if (isLidarFlight) {
        setBackgroundLayer(lidarFlightGround(style, lidarModel));
      }
    },
    [
      isLidarFlight,
      lidarModel,
      setAutoDataset,
      setActiveLidarStyle,
      setBackgroundLayer,
    ],
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

  // A row click picks and dismisses. Both are the user speaking, so both pin.
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

  // Automatisk is the one control that hands the choice back rather than making
  // one, which is why it is a button beside the pulldowns and not a row inside
  // one: with it on, every row in there is something Automatisk may overrule on
  // the next pan.
  //
  // Switching it off changes nothing on screen — the pin lands on whatever is
  // already drawing. Switching it on re-decides at once, with a null incumbent
  // so the resolver cannot inherit the pin and leave Automatisk looking like it
  // did nothing.
  const toggleAuto = () => {
    if (autoDataset) {
      setAutoDataset(false);
      return;
    }
    setAutoDataset(true);
    const choice = chooseAutoDataset({ resolution, viewport, current: null });
    if (choice.kind === 'national') selectNational();
    else if (choice.kind === 'project') selectProject(choice.project);
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

  // The other direction, and the only thing that ever turns Automatisk back on
  // by itself: a pin is a choice about a flight, and once the reader has panned
  // clear of that flight it is a choice about nothing — the background is blank
  // ground, and the way out is a toggle they have to remember pressing. So the
  // pin lapses and the resolver above takes the next screen.
  //
  // Its own `moveend`, not the resolution one: this needs the extent rather
  // than the scale, it is subscribed only while a pinned flight is drawing, and
  // reading the rectangle here keeps it out of component state — a new array
  // every pan would re-render the ring for a question answered in place.
  //
  // Moves only, never on mount: the pulldown lists every flight that touches
  // the viewport, so one picked off the far end of that list can be under the
  // bar the moment it is picked, and a pick undone before the reader has moved
  // is not a lapsed pin — it is a control that does not work.
  useEffect(() => {
    if (autoDataset || !isLidarFlight || !activeLidarProject) return;
    const check = () => {
      if (pinnedFlightLeftBehind(activeLidarProject, viewportBbox(map))) {
        setAutoDataset(true);
      }
    };
    map.on('moveend', check);
    return () => {
      map.un('moveend', check);
    };
  }, [map, autoDataset, isLidarFlight, activeLidarProject, setAutoDataset]);

  // A shared `?backgroundLayer=lidarCvat` names the ground but not the flight,
  // so it arrives with none and draws nothing for a tick. Nothing extra is
  // needed to fill it in: Automatisk is on at every cold load, the resolver
  // above names the flight as soon as the footprints land, and
  // `preferredLidarRender` puts the render back on the cache where the store has
  // it. Where it does not, the link resolves to the flight's WMS, which is the
  // honest answer rather than a blank.

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
    toggleAuto,
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
