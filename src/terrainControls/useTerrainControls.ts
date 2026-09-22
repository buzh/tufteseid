// Terrenganalyse's controller: whether the client is computing its own relief
// over a rectangle of ground, and what of it.
//
// Mounted by `MapComponent`, beside the map and not in the band, because that
// is where its surface floats. Mounted unconditionally, though the box only
// appears while an analysis is up: everything below the rectangle is held here
// in component state, and a hook that came and went with the box would hand a
// reader their default sun back every time they took a render down to look at
// the ground under it.
//
// Exactly one mount. A second would be a second DEM, a second horizon scan and
// a second canvas over the same ground.
//
// `terrainWindowAtom` is the on switch as well as the rectangle: null is the
// analysis off. Nothing else records it, which is what lets the ribbon's button
// (`useTerrainToggle`) start and stop the analysis without touching any of this
// — it writes the atom, and the frame on the map (`windowLayer.ts`), the render
// (`terrainLayer.ts`) and the box all follow from there.

import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bbox } from '../map/bbox';
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
import { frameTerrainWindowAtom, terrainWindowAtom } from '../terrain/window';

// One fetch's outcome, stamped with what it was a fetch of. The fetch effect's
// cleanup drops it, so nothing stale is held for long — but a cleanup runs
// after the render that caused it, so there is exactly one pass in which the
// rectangle is new and this is the previous one's. The stamp is what covers it.
type DemResult = {
  bbox: Bbox;
  model: DemModel;
  dem: Dem | null;
  error: 'failed' | 'empty' | null;
};

export const useTerrainControls = () => {
  const bbox = useAtomValue(terrainWindowAtom);
  const setWindow = useSetAtom(terrainWindowAtom);
  const frameWindow = useSetAtom(frameTerrainWindowAtom);

  const [model, setModel] = useState<DemModel>('dtm');
  const [result, setResult] = useState<DemResult | null>(null);

  // Derived rather than cleared. A grid belongs to the rectangle and the model
  // it was fetched for, so the moment either changes it stops being the answer
  // — there is no window in which the box reads out the previous rectangle's
  // resolution, and no loading flag that can be left standing by a fetch that
  // ended in a way nobody thought about.
  const answer =
    result && result.bbox === bbox && result.model === model ? result : null;
  const dem = answer?.dem ?? null;
  const error = answer?.error ?? null;
  const loading = bbox !== null && answer === null;

  const [vis, setVis] = useState<Visualization>('hillshade');
  const [azimuth, setAzimuth] = useState(DEFAULT_AZIMUTH);
  const [altitude, setAltitude] = useState(DEFAULT_ALTITUDE);
  const [zFactor, setZFactor] = useState(DEFAULT_Z_FACTOR);
  // Percent, and counted as opacity: OpenLayers wants it that way and the
  // slider is the one place it is spoken of as transparency.
  const [opacity, setOpacity] = useState(100);

  // Two radii, split by quantity: smoothing distance (LRM) versus horizon
  // search distance (sky-view and both opennesses). Switching within the
  // horizon family must keep the number, or the horizon memo misses its cache.
  // VAT takes neither — its two search radii are pinned by the RVT presets.
  const [lrmRadius, setLrmRadius] = useState(DEFAULT_LRM_RADIUS);
  const [svfRadius, setSvfRadius] = useState(DEFAULT_SVF_RADIUS);
  const horizonVis = usesHorizon(vis);
  // Exposed clamped, so slider, readout and render agree; stored unclamped, so
  // a radius capped on one grid returns in full on another.
  const rawRadius = horizonVis ? svfRadius : lrmRadius;
  const radius = dem ? clampRadius(vis, dem, rawRadius) : rawRadius;
  const setRadius = useCallback(
    (value: number) => (horizonVis ? setSvfRadius : setLrmRadius)(value),
    [horizonVis],
  );

  // Off-DOM, and not React's: the OL image source draws from this exact
  // element, so a new canvas per slider frame would rebuild the layer's image
  // as well as the pixels.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Keyed on the atom's array identity, which is safe here because nothing
  // writes an equal one: `frameTerrainWindowAtom` builds a fresh rectangle out
  // of the viewport and the off switch writes null.
  //
  // The cleanup is where the grid is released, and it is the only place — 19 MB
  // is the whole reason the analysis has an off switch, and holding it against
  // a rectangle the reader has left is what the off switch is for. Putting it
  // here rather than in the verbs means the verbs are pure atom writes, which
  // is what lets the ribbon's button stop an analysis it holds no state for.
  // The abort matters for the same reason `Analyser her` runs through here:
  // both retrigger this while several megabytes are still in flight.
  useEffect(() => {
    if (!bbox) return;
    const controller = new AbortController();
    fetchDem(bbox, { model, signal: controller.signal })
      .then((dem) => {
        if (controller.signal.aborted) return;
        // Null is the catalogue saying nothing was ever flown here; a throw is
        // the fetch failing, and reporting that as an absence of laser data
        // would be a lie.
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
  }, [bbox, model]);

  // The one expensive pass — some 800 ms on a 600² grid — read three ways
  // (sky-view and both opennesses). Must not be keyed on `vis` or on the
  // azimuth, and is clamped through 'svf' so all three resolve to one radius:
  // either mistake costs the whole scan per menu click, silently.
  const horizonRadius = dem ? clampRadius('svf', dem, svfRadius) : svfRadius;
  const horizon = useMemo(
    () => (dem && horizonVis ? computeHorizonFields(dem, horizonRadius) : null),
    [dem, horizonVis, horizonRadius],
  );

  // Sun-independent. Cheap by itself, but the radius is a key on this and on
  // the horizon memo both, which is why the radius slider commits on release
  // for the horizon views and streams for LRM's 23 ms blur.
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
      // The painted canvas is RGBA at the grid's own size — 16 MB at the
      // ceiling — and nothing else drops it; the layer only stopped reading it.
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

  // Both on the way out. The layer and the atom outlive this hook — one is a
  // module, the other the store — so a host that unmounted the control would
  // otherwise leave a render and a frame on the map with nothing to work them.
  useEffect(
    () => () => {
      setTerrainRender(null);
      setWindow(null);
    },
    [setWindow],
  );

  return {
    /** There is a rectangle, so there is a box to draw. */
    on: bbox !== null,
    /**
     * Move the analysis to what is on the screen now. Answering false is the
     * map having no size yet, which is before first layout and so not a state
     * a reader can press a button in; the caller passes over it in silence.
     */
    reframe: frameWindow,
    /** Metres on a side, once there is a grid to measure. */
    sideMetres: dem ? Math.round(dem.bbox25833[2] - dem.bbox25833[0]) : null,
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
