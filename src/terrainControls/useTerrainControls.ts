import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { terrainOfferAtom } from '../evidence/offer';
import { bboxWidthMetres, type Bbox } from '../map/bbox';
import { fetchDem, type Dem, type DemModel } from '../terrain/dem';
import {
  clampRadius,
  DEFAULT_ALTITUDE,
  DEFAULT_AZIMUTH,
  DEFAULT_LRM_RADIUS,
  DEFAULT_SVF_RADIUS,
  DEFAULT_Z_FACTOR,
  demImageExtent,
  paintTerrainField,
  radiusRange,
  terrainField,
  terrainStaticField,
  usesHorizon,
} from '../terrain/render';
import { computeHorizonFields, type Visualization } from '../terrain/shade';
import { setTerrainOpacity, setTerrainRender } from '../terrain/terrainLayer';
import { releaseSpotFootprintAtom } from '../spots/atoms';
import {
  adjustTerrainWindowAtom,
  closeTerrainWindowAtom,
  terrainAdjustingAtom,
  terrainWindowAtom,
} from '../terrain/window';
import { useRectangleAdjust } from '../map/rectAdjust';

type DemResult = {
  bbox: Bbox;
  model: DemModel;
  dem: Dem | null;
  error: 'failed' | 'empty' | null;
};

export const useTerrainControls = () => {
  const bbox = useAtomValue(terrainWindowAtom);
  const adjusting = useAtomValue(terrainAdjustingAtom);
  const setAdjusting = useSetAtom(terrainAdjustingAtom);
  const adjustWindow = useSetAtom(adjustTerrainWindowAtom);
  const closeWindow = useSetAtom(closeTerrainWindowAtom);
  const releaseFootprint = useSetAtom(releaseSpotFootprintAtom);
  const setTerrainOffer = useSetAtom(terrainOfferAtom);

  useRectangleAdjust({
    rectAtom: terrainWindowAtom,
    activeAtom: terrainAdjustingAtom,
    layerId: 'terrainAdjustLayer',
  });

  const [model, setModel] = useState<DemModel>('dtm');
  const [result, setResult] = useState<DemResult | null>(null);

  const answer =
    result && result.bbox === bbox && result.model === model ? result : null;
  const dem = answer?.dem ?? null;
  const error = answer?.error ?? null;
  const loading = bbox !== null && !adjusting && answer === null;

  const [vis, setVis] = useState<Visualization>('hillshade');
  const [azimuth, setAzimuth] = useState(DEFAULT_AZIMUTH);
  const [altitude, setAltitude] = useState(DEFAULT_ALTITUDE);
  const [zFactor, setZFactor] = useState(DEFAULT_Z_FACTOR);
  const [opacity, setOpacity] = useState(100);

  const [lrmRadius, setLrmRadius] = useState(DEFAULT_LRM_RADIUS);
  const [svfRadius, setSvfRadius] = useState(DEFAULT_SVF_RADIUS);
  const horizonVis = usesHorizon(vis);
  const rawRadius = horizonVis ? svfRadius : lrmRadius;
  const radius = dem ? clampRadius(vis, dem, rawRadius) : rawRadius;
  const setRadius = useCallback(
    (value: number) => (horizonVis ? setSvfRadius : setLrmRadius)(value),
    [horizonVis],
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!bbox || adjusting) return;
    const controller = new AbortController();
    fetchDem(bbox, { model, signal: controller.signal })
      .then((dem) => {
        if (controller.signal.aborted) return;
        setResult({ bbox, model, dem, error: dem ? null : 'empty' });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setResult({ bbox, model, dem: null, error: 'failed' });
      });
    return () => {
      controller.abort();
      setResult(null);
    };
  }, [bbox, model, adjusting]);

  const horizonRadius = dem ? clampRadius('svf', dem, svfRadius) : svfRadius;
  const horizon = useMemo(
    () => (dem && horizonVis ? computeHorizonFields(dem, horizonRadius) : null),
    [dem, horizonVis, horizonRadius],
  );

  const staticField = useMemo(
    () => (dem ? terrainStaticField(dem, vis, radius, horizon) : null),
    [dem, vis, radius, horizon],
  );

  const radiusLimits = useMemo(
    () => (dem ? radiusRange(vis, dem) : null),
    [dem, vis],
  );

  const field = useMemo(
    () =>
      dem
        ? terrainField(dem, vis, { azimuth, altitude, zFactor }, staticField)
        : null,
    [dem, vis, azimuth, altitude, zFactor, staticField],
  );

  useEffect(() => {
    if (!dem || !field) {
      setTerrainRender(null);
      canvasRef.current = null;
      return;
    }
    const canvas = (canvasRef.current ??= document.createElement('canvas'));
    if (!paintTerrainField(field, dem, vis, canvas)) return;
    setTerrainRender({ canvas, extent25833: demImageExtent(dem) });
  }, [dem, field, vis]);

  useEffect(() => {
    setTerrainOpacity(opacity / 100);
  }, [opacity]);

  useEffect(() => {
    setTerrainOffer(
      dem && field
        ? { kind: 'terrain', vis, model, azimuth, altitude, zFactor, radius }
        : null,
    );
  }, [
    dem,
    field,
    vis,
    model,
    azimuth,
    altitude,
    zFactor,
    radius,
    setTerrainOffer,
  ]);

  useEffect(
    () => () => {
      setTerrainRender(null);
      setTerrainOffer(null);
      closeWindow();
    },
    [closeWindow, setTerrainOffer],
  );

  return {
    on: bbox !== null,
    adjusting,
    start: useCallback(() => setAdjusting(false), [setAdjusting]),
    adjust: useCallback(() => {
      releaseFootprint();
      adjustWindow();
    }, [releaseFootprint, adjustWindow]),
    close: closeWindow,
    sideMetres: dem
      ? Math.round(dem.bbox25833[2] - dem.bbox25833[0])
      : bbox
        ? Math.round(bboxWidthMetres(bbox))
        : null,
    vis,
    setVis,
    model,
    setModel,
    dem,
    loading,
    error,
    azimuth,
    setAzimuth,
    altitude,
    setAltitude,
    zFactor,
    setZFactor,
    radius,
    setRadius,
    radiusLimits,
    opacity,
    setOpacity,
  };
};

export type TerrainControls = ReturnType<typeof useTerrainControls>;
