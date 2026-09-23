import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import { mapAtom } from '../map/atoms';
import { viewportBbox } from '../map/bbox';
import type { CompareHalf } from '../map/compare/halves';
import {
  backgroundLayerHalves,
  hybridContoursHalves,
  hybridOverlayHalves,
} from '../map/layers/config/backgroundLayers/atoms';
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
  const [activeCvat, setActiveCvat] = useAtom(activeCvatAcquisitionHalves[half]);
  const [lidarModel, setLidarModel] = useAtom(activeLidarModelHalves[half]);
  const [autoDataset, setAutoDataset] = useAtom(lidarAutoDatasetHalves[half]);
  const [hybridOverlay, setHybridOverlay] = useAtom(hybridOverlayHalves[half]);
  const [hybridContours, setHybridContours] = useAtom(
    hybridContoursHalves[half],
  );

  // `lidarFootprintsLayer` paints footprints only while this is open.
  const [pickerOpen, setPickerOpen] = useAtom(lidarPickerOpenHalves[half]);
  const setHoveredProjectId = useSetAtom(hoveredLidarProjectIdAtom);

  // Filled by `lidarFootprintsLayer`: one WFS pass over the viewport, shared.
  const viewport = useAtomValue(lidarViewportAtom);

  // Fetched at runtime; empty on an install without a store, never rejects.
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

  // The mosaic's styles; a flight's are already in its catalogue row.
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
  // `lidarProject` and `lidarCvat` are the same dataset under two names: the
  // flight rendered by Kartverket's WMS, or by us onto our own disk.
  const isLidarCvat = backgroundLayer === 'lidarCvat';
  const isLidarFlight = backgroundLayer === 'lidarProject' || isLidarCvat;
  const isLidarBackground = isLidarFlight || isNationalMosaic;

  // Metres per pixel; the view is EPSG:25833.
  const [resolution, setResolution] = useState<number | null>(null);
  useEffect(() => {
    const read = () => setResolution(map.getView().getResolution() ?? null);
    read();
    map.on('moveend', read);
    return () => {
      map.un('moveend', read);
    };
  }, [map]);

  // Both clamp the render to what the target offers: the mosaic serves only
  // `skyggerelieff`, and `cvat` draws only where the store holds that flight.
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

  // With auto on the dataset is chosen up front rather than left to the
  // resolver: landing on the mosaic first costs two screenfuls of WMS requests.
  const enterLidar = () => {
    const choice = autoDataset
      ? chooseAutoDataset({ resolution, viewport, current: null })
      : ({ kind: 'hold' } as const);
    if (choice.kind === 'project') selectProject(choice.project);
    else selectNational();
  };

  // Every branch compares against what is drawing before writing, or the pass
  // its own write triggers would loop.
  useEffect(() => {
    if (!isLidarBackground || !autoDataset) return;
    const choice = chooseAutoDataset({
      resolution,
      viewport,
      // The mosaic leaves `activeLidarProject` holding the last flight.
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

  // A pin lapses back to Automatisk once the reader pans clear of the flight.
  // Moves only, never on mount: a flight picked off the far end of the pulldown
  // can already be off-screen when it is picked.
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

  const datasetStyles = stylesForModel(
    isLidarFlight && activeLidarProject
      ? stylesForFlight(activeLidarProject, activeCvat)
      : nationalStyles,
    lidarModel,
  );
  const tierAStyles = TIER_A_STYLES.filter((s) => datasetStyles.includes(s));
  const tierBStyles = datasetStyles.filter((s) => !TIER_A_STYLES.includes(s));
  const shownStyle = effectiveLidarStyle(activeLidarStyle, lidarModel);
  const cachedFlightIds = new Set(cvatAcquisitions.map((a) => a.project.id));

  return {
    isNationalMosaic,
    isLidarFlight,
    isLidarCvat,
    enterLidar,

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

    tierAStyles,
    tierBStyles,
    shownStyle,
    selectStyle,
    lidarModel,
    selectModel,

    hybridOverlay,
    toggleHybrid: () => setHybridOverlay((on) => !on),
    hybridContours,
    toggleContours: () => setHybridContours((on) => !on),
  };
};

export type LidarControls = ReturnType<typeof useLidarControls>;
