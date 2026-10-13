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
  linkedLidarRender,
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
import { lidarNativeResolution } from '../map/layers/config/backgroundLayers/stack';

let linkRender: string | null = linkedLidarRender;

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
  const [activeCvat, setActiveCvat] = useAtom(
    activeCvatAcquisitionHalves[half],
  );
  const [lidarModel, setLidarModel] = useAtom(activeLidarModelHalves[half]);
  const [autoDataset, setAutoDataset] = useAtom(lidarAutoDatasetHalves[half]);
  const [hybridOverlay, setHybridOverlay] = useAtom(hybridOverlayHalves[half]);
  const [hybridContours, setHybridContours] = useAtom(
    hybridContoursHalves[half],
  );

  const [pickerOpen, setPickerOpen] = useAtom(lidarPickerOpenHalves[half]);
  const setHoveredProjectId = useSetAtom(hoveredLidarProjectIdAtom);

  const viewport = useAtomValue(lidarViewportAtom);

  const [cvatAcquisitions, setCvatAcquisitions] = useState<
    CvatAcquisition[] | null
  >(null);
  useEffect(() => {
    let cancelled = false;
    fetchCvatAcquisitions().then((held) => {
      if (!cancelled) setCvatAcquisitions(held);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const isLidarCvat = backgroundLayer === 'lidarCvat';
  const isLidarFlight = backgroundLayer === 'lidarProject' || isLidarCvat;
  const isLidarBackground = isLidarFlight || isNationalMosaic;

  const [resolution, setResolution] = useState<number | null>(null);
  useEffect(() => {
    const read = () => setResolution(map.getView().getResolution() ?? null);
    read();
    map.on('moveend', read);
    return () => {
      map.un('moveend', read);
    };
  }, [map]);

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
      const cached = cvatFor(cvatAcquisitions ?? [], p);
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

  const enterLidar = () => {
    const choice = autoDataset
      ? chooseAutoDataset({ resolution, viewport, current: null })
      : ({ kind: 'hold' } as const);
    if (choice.kind === 'project') selectProject(choice.project);
    else selectNational();
  };

  useEffect(() => {
    if (!isLidarBackground || !autoDataset) return;
    const choice = chooseAutoDataset({
      resolution,
      viewport,

      current: isLidarFlight ? activeLidarProject : null,
    });
    if (choice.kind === 'hold') return;
    if (choice.kind === 'national') {
      const settled = nationalStyles.length > 0;
      const wanted = (settled && linkRender) || undefined;

      if (!isNationalMosaic || wanted) selectNational(wanted);
      if (settled) linkRender = null;
    } else if (choice.kind === 'project') {
      const settled = cvatAcquisitions != null;
      const wanted = (settled && linkRender) || undefined;

      if (
        wanted ||
        !isLidarFlight ||
        activeLidarProject?.id !== choice.project.id
      ) {
        selectProject(choice.project, wanted);
      }
      if (settled) linkRender = null;
    }
  }, [
    isLidarBackground,
    autoDataset,
    resolution,
    viewport,
    isLidarFlight,
    isNationalMosaic,
    activeLidarProject,
    nationalStyles,
    cvatAcquisitions,
    selectNational,
    selectProject,
  ]);

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
  const cachedFlightIds = new Set(
    (cvatAcquisitions ?? []).map((a) => a.project.id),
  );

  const nativeResolution = lidarNativeResolution(backgroundLayer, activeCvat);
  const magnification =
    resolution != null && nativeResolution != null
      ? Math.max(1, Math.round(nativeResolution / resolution))
      : 1;

  return {
    isNationalMosaic,
    isLidarFlight,
    isLidarCvat,
    enterLidar,

    activeLidarProject,
    activeCvat,
    cachedFlightIds,
    nativeResolution,
    magnification,
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
