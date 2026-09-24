// Exactly one mount: a second is a second DEM, horizon scan and canvas over the
// same ground. `terrainWindowAtom` null is the analysis off.

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
import {
  adjustTerrainWindowAtom,
  closeTerrainWindowAtom,
  terrainAdjustingAtom,
  terrainWindowAtom,
} from '../terrain/window';
import { useRectangleAdjust } from '../map/rectAdjust';

// Stamped with what it was a fetch of: a cleanup runs after the render that
// caused it, so one pass sees a new rectangle against the previous result.
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
  // Percent, as opacity; the layer takes 0–1.
  const [opacity, setOpacity] = useState(100);

  // LRM's smoothing distance, and one horizon search distance shared by
  // sky-view and both opennesses — split, the horizon memo misses its cache.
  const [lrmRadius, setLrmRadius] = useState(DEFAULT_LRM_RADIUS);
  const [svfRadius, setSvfRadius] = useState(DEFAULT_SVF_RADIUS);
  const horizonVis = usesHorizon(vis);
  // Exposed clamped, stored unclamped: a radius capped on one grid returns in
  // full on another.
  const rawRadius = horizonVis ? svfRadius : lrmRadius;
  const radius = dem ? clampRadius(vis, dem, rawRadius) : rawRadius;
  const setRadius = useCallback(
    (value: number) => (horizonVis ? setSvfRadius : setLrmRadius)(value),
    [horizonVis],
  );

  // The OL image source draws from this exact element; a new canvas per slider
  // frame would rebuild the layer's image as well as the pixels.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // `adjusting` guards the fetch — a drag writes a rectangle per frame — and
  // keys it. The cleanup is the only place the ~19 MB grid is released.
  useEffect(() => {
    if (!bbox || adjusting) return;
    const controller = new AbortController();
    fetchDem(bbox, { model, signal: controller.signal })
      .then((dem) => {
        if (controller.signal.aborted) return;
        // Null is the catalogue reporting nothing flown here; a throw is the
        // fetch failing.
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

  // ~800 ms on a 600² grid. Not keyed on `vis` or azimuth, and clamped through
  // 'svf' so all three horizon views share one radius; either costs a rescan.
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
      // RGBA at the grid's own size, 16 MB at the ceiling, and nothing else
      // drops it: the layer only stopped reading it.
      canvasRef.current = null;
      return;
    }
    const canvas = (canvasRef.current ??= document.createElement('canvas'));
    if (!paintTerrainField(field, dem, vis, canvas)) return;
    setTerrainRender({ canvas, extent25833: demImageExtent(dem) });
  }, [dem, field, vis]);

  // The layer's alpha is module-level and outlives this hook, so it is pushed
  // back on every mount rather than only when the slider moves.
  useEffect(() => {
    setTerrainOpacity(opacity / 100);
  }, [opacity]);

  // What a keep would re-run over the spot's footprint. These settings are
  // component state, so unlike the ground's offer it cannot be derived — it has
  // to be published. `radius` goes out clamped, because that is the distance
  // the reading on screen was made at.
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

  // The layer and the atoms outlive this hook, so an unmount would leave a
  // render and a frame on the map with nothing to work them, and an offer to
  // keep an analysis nobody is running.
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
    adjust: adjustWindow,
    close: closeWindow,
    /** Metres on a side: off the grid where there is one, else the rectangle. */
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
