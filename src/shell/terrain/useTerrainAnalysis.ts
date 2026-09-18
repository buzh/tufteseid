// Mounted once, from RibbonGlobalRow: a second mount means a second DEM.

import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalityBbox } from '../../api/localities';
import {
  activeLocalityAtom,
  coverTerrainSpecAtom,
} from '../../localities/atoms';
import type { BeholdKey, BeholdSpec } from '../../localities/behold';
import { ribbonToolAtom } from '../../localities/toolAtoms';
import {
  setGroundOverlay,
  setGroundOverlayOpacity,
  TERRAIN_KEY,
} from '../../map/groundOverlay';
import type { CycleKey } from '../../map/useBackgroundCyclingKeys';
import { fetchDem, type Dem, type DemModel } from '../../terrain/dem';
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
} from '../../terrain/render';
import { computeHorizonFields, type Visualization } from '../../terrain/shade';
import { frameTerrainWindowAtom, terrainWindowAtom } from '../../terrain/window';

// Pulldown and W/S order. VAT sits next to the three horizon views on purpose:
// they share one ray walk, so walking between them is free rather than ~800 ms.
export const VISUALIZATIONS: Visualization[] = [
  'hillshade',
  'multiHillshade',
  'vat',
  'svf',
  'openPos',
  'openNeg',
  'lrm',
  'slope',
];

export const useTerrainAnalysis = () => {
  const { t } = useTranslation();
  const locality = useAtomValue(activeLocalityAtom);
  const coverTerrainSpec = useAtomValue(coverTerrainSpecAtom);
  const tool = useAtomValue(ribbonToolAtom);
  const terrainWindow = useAtomValue(terrainWindowAtom);
  const frameTerrainWindow = useSetAtom(frameTerrainWindowAtom);

  // With a lokalitet open, its own bbox rather than a copy, so "Juster området"
  // refetches the DEM for free. Without one, the standalone window
  // (`src/terrain/window.ts`), which `useGroundMode` clears the moment a
  // lokalitet arrives — so the two branches can never both be live.
  const bbox: LocalityBbox | null = locality
    ? tool === 'terrain'
      ? locality.bbox
      : null
    : terrainWindow;

  const [model, setModel] = useState<DemModel>('dtm');
  const [dem, setDem] = useState<Dem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'failed' | 'empty' | null>(null);

  const [vis, setVis] = useState<Visualization>('hillshade');
  const [azimuth, setAzimuth] = useState(DEFAULT_AZIMUTH);
  const [altitude, setAltitude] = useState(DEFAULT_ALTITUDE);
  const [zFactor, setZFactor] = useState(DEFAULT_Z_FACTOR);
  // Percent.
  const [opacity, setOpacity] = useState(100);

  // Two radii, split by quantity: smoothing distance (LRM) versus horizon
  // search distance (svf, both opennesses, VAT). Switching within the horizon
  // family must keep the number, or the horizon memo misses its cache.
  const [lrmRadius, setLrmRadius] = useState(DEFAULT_LRM_RADIUS);
  const [svfRadius, setSvfRadius] = useState(DEFAULT_SVF_RADIUS);
  const horizonVis = usesHorizon(vis);
  // Exposed clamped so slider, readout, render and caption agree; stored
  // unclamped, so a radius capped on one grid returns in full on another.
  const rawRadius = horizonVis ? svfRadius : lrmRadius;
  const radius = dem ? clampRadius(vis, dem, rawRadius) : rawRadius;
  const setRadius = useCallback(
    (value: number) => (horizonVis ? setSvfRadius : setLrmRadius)(value),
    [horizonVis],
  );

  const [pickerOpen, setPickerOpen] = useState(false);

  // Off-DOM, and not React's: the OL image source draws from this exact element.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Knobs already off the defaults: the seed below, or a Gjenskap before it.
  const seededRef = useRef(false);

  const bboxKey = bbox ? bbox.join(',') : null;

  // The abort matters: resizing a lokalitet retriggers this while several
  // megabytes are still in flight.
  useEffect(() => {
    if (!bbox) {
      setDem(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDem(null);
    fetchDem(bbox, { model, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result) setError('empty');
        else setDem(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('failed');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // bboxKey, not bbox: the array is a fresh identity on every record update,
    // so depending on it would refetch on an unrelated rename.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bboxKey, model]);

  // The one expensive pass, ~800 ms on a 600² grid, and read four ways (svf,
  // both opennesses, VAT). Must not be keyed on `vis` or on azimuth, and is
  // clamped through 'svf' so all four horizon views resolve to one radius —
  // either mistake costs the whole scan per ring step, silently.
  const horizonRadius = dem ? clampRadius('svf', dem, svfRadius) : svfRadius;
  const horizon = useMemo(
    () => (dem && horizonVis ? computeHorizonFields(dem, horizonRadius) : null),
    [dem, horizonVis, horizonRadius],
  );

  // Sun-independent. Cheap by itself, but radius is a key on both this and the
  // horizon memo, which is why the radius slider commits on release for the
  // horizon views and streams for LRM's 23 ms blur.
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
      setGroundOverlay(TERRAIN_KEY, null);
      return;
    }
    // Reused: a new canvas per slider frame rebuilds the layer's image too.
    const canvas = (canvasRef.current ??= document.createElement('canvas'));
    if (!paintTerrainField(field, dem, vis, canvas)) return;
    setGroundOverlay(TERRAIN_KEY, {
      source: canvas,
      crop: { x: 0, y: 0, width: canvas.width, height: canvas.height },
      extent25833: demImageExtent(dem),
    });
  }, [dem, field, vis]);

  // The stack's alpha is module-level and outlives this hook, so it has to be
  // pushed back on every mount.
  useEffect(() => {
    setGroundOverlayOpacity(TERRAIN_KEY, opacity / 100);
  }, [opacity]);

  // Only the render: a kept bilde is a member of its own. The window goes too,
  // or row 1 crashing into its boundary would leave a frame on the map around
  // an analysis that is no longer running.
  const setTerrainWindow = useSetAtom(terrainWindowAtom);
  useEffect(
    () => () => {
      setGroundOverlay(TERRAIN_KEY, null);
      setTerrainWindow(null);
    },
    [setTerrainWindow],
  );

  /**
   * A spec, not pixels — the pin queue paints it later, so `metresPerPx` is
   * deliberately absent. Null while the DEM loads, which callers treat as
   * "not now" rather than an error.
   */
  const describe = useCallback((): BeholdSpec | null => {
    if (!dem) return null;
    const label = t(`localities.terrain.vis.${vis}`);
    return {
      // Reuses `extract`; a new kind would need a PocketBase migration.
      kind: 'extract',
      caption: `${label} · ${model.toUpperCase()}`,
      meta: {
        sourceLabel: t('localities.terrain.sourceLabel'),
        style: vis,
        model,
        // Read by the duplicate guard before any pixels exist.
        bbox25833: dem.bbox25833,
        ...(vis === 'hillshade' ? { azimuth } : {}),
        altitude,
        zFactor,
        // Already clamped; the pin clamps again against the grid it gets.
        ...(radiusLimits ? { radius } : {}),
      },
    };
  }, [dem, vis, model, azimuth, altitude, zFactor, radius, radiusLimits, t]);

  // The duplicate guard's key: style, model and params are compared against
  // what `describe` puts in `meta`, so the two lists have to stay the same or
  // the guard silently stops matching.
  const beholdKey = useMemo((): BeholdKey | null => {
    if (!dem) return null;
    return {
      kind: 'terrain',
      // Unread on this branch: the guard tells a terrain render from a LiDAR
      // extract by `meta` carrying no sourceKey at all.
      sourceKey: '',
      style: vis,
      model,
      params: {
        ...(vis === 'hillshade' ? { azimuth } : {}),
        altitude,
        zFactor,
        ...(radiusLimits ? { radius } : {}),
      },
    };
  }, [dem, vis, model, azimuth, altitude, zFactor, radius, radiusLimits]);

  const activate = (next: Visualization) => {
    setVis(next);
    setPickerOpen(false);
  };

  /**
   * Gjenskap's terrain arm. One method rather than six setters because the
   * radius has to be routed by the *target* visualization; an outside caller
   * would hand it to whichever family was showing. Stands the cover seed down.
   */
  const restoreView = useCallback(
    (v: {
      vis: Visualization;
      model: DemModel;
      azimuth: number;
      altitude: number;
      zFactor: number;
      radius?: number;
    }) => {
      seededRef.current = true;
      setModel(v.model);
      setVis(v.vis);
      setAzimuth(v.azimuth);
      setAltitude(v.altitude);
      setZFactor(v.zFactor);
      if (v.radius != null) {
        (usesHorizon(v.vis) ? setSvfRadius : setLrmRadius)(v.radius);
      }
    },
    [],
  );

  // Arms the cover seed below once per lokalitet — a knob moved on a second
  // visit must survive, and a fork from `Lag min kopi` is not a new lokalitet
  // here: re-seeding would discard the knobs that were the reason to copy.
  // Must stay declared before the seed effect; effects run in declaration order.
  const previousLocalityId = useRef(locality?.id ?? null);
  useEffect(() => {
    const from = previousLocalityId.current;
    const id = locality?.id ?? null;
    // Keyed on the whole record to read `derivedFrom`, so the no-op case is
    // checked by hand: the atom is a fresh object on every rename.
    if (id === from) return;
    previousLocalityId.current = id;
    if (locality && from && locality.derivedFrom === from) return;
    seededRef.current = false;
  }, [locality]);

  // Open on the light the lokalitet's cover render was made in. `restoreView`
  // sets the flag too, so a Gjenskap entering the ground in the same commit is
  // not overwritten by the cover.
  useEffect(() => {
    if (tool !== 'terrain' || !coverTerrainSpec || seededRef.current) return;
    restoreView(coverTerrainSpec);
  }, [tool, coverTerrainSpec, restoreView]);

  // Called by useGroundMode: an unmounted popover never fires its own
  // open-change callback, so it would come back open.
  const standDown = useCallback(() => setPickerOpen(false), []);

  // The dataset ring: visualizations on W/S, DTM/DOM on E as in LiDAR.
  const cycle = (key: CycleKey): boolean => {
    if (key === 'e') {
      setModel((current) => (current === 'dtm' ? 'dom' : 'dtm'));
      return true;
    }
    if (key !== 'w' && key !== 's') return false;
    const step = key === 's' ? 1 : -1;
    const at = VISUALIZATIONS.indexOf(vis);
    const ring = VISUALIZATIONS.length;
    setVis(VISUALIZATIONS[(at + step + ring) % ring]);
    return true;
  };

  return {
    cycle,
    standDown,
    // Reading with nothing open: the rectangle is the window rather than a
    // record's, so the strip offers to move it and nothing offers to keep it.
    standalone: locality == null,
    reframe: frameTerrainWindow,
    pickerOpen,
    setPickerOpen,
    activate,
    restoreView,
    model,
    setModel,
    // No bare `setVis`: the ways in are `activate` and `cycle`.
    vis,
    dem,
    loading,
    error,
    // Reaches the lokalitet row through `beholdOfferAtom`, not props: it and
    // row 1 are siblings.
    describe,
    beholdKey,
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

export type TerrainAnalysis = ReturnType<typeof useTerrainAnalysis>;
