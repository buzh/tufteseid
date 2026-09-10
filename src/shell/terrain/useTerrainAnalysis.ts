// Terrenganalyse: pull the float DEM for a rectangle once, then re-light and
// re-process it locally, so azimuth is a slider over data already in memory
// rather than a new WMS request.
//
// All of the tool's state lives here, mounted once from RibbonGlobalRow
// alongside useLidarControls and useFlyfotoControls — for the same reason
// those are: the controls it feeds are spread over two ribbon rows, and the
// DEM, the canvas and the render are one thing that must not exist twice.
//
// The render goes on the **map**, never in a row: terrainOverlayLayer.ts puts
// the canvas down as a georeferenced image layer over the background, so
// scrubbing the light re-lights the ground in place, under the Kulturminner
// layers and the lokalitet's own drawing.
//
// Two entrances resolve to one rectangle here rather than in two callers. A
// lokalitet's Terreng analyses its bbox and saves into its Bilder; row 1's
// Terreng with nothing open analyses the visible map and turns that rectangle
// into a lokalitet on the way out. They can never both be live: opening a
// lokalitet clears the standalone rectangle.
//
// Why any of this: docs/terrain-analysis.md. The control surface:
// docs/ui-architecture.md §10.

import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createAttachment } from '../../api/attachments';
import type { LocalityBbox } from '../../api/localities';
import { currentUserAtom } from '../../auth/atoms';
import { isAuthDialogOpenAtom } from '../../auth/atoms-dialog';
import { renderFigureBlob } from '../../figure/figure';
import { terrainFigure } from '../../figure/specs';
import { activeLocalityAtom } from '../../localities/atoms';
import { createLocalityFromBbox } from '../../localities/createFromBbox';
import { ribbonToolAtom } from '../../localities/toolAtoms';
import { terrainStandaloneBboxAtom } from '../../terrain/atoms';
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
} from '../../terrain/render';
import { type Visualization } from '../../terrain/shade';
import {
  hideTerrainOverlay,
  setTerrainOverlayOpacity,
  showTerrainOverlay,
} from '../../terrain/terrainOverlayLayer';
import { useTerrainViewport } from '../../terrain/useTerrainViewport';
import { toast } from '../../ui';

export const VISUALIZATIONS: Visualization[] = [
  'hillshade',
  'multiHillshade',
  'svf',
  'lrm',
  'slope',
];

export const useTerrainAnalysis = () => {
  const { t } = useTranslation();
  const user = useAtomValue(currentUserAtom);
  const openAuthDialog = useSetAtom(isAuthDialogOpenAtom);
  const locality = useAtomValue(activeLocalityAtom);
  const setActiveLocality = useSetAtom(activeLocalityAtom);
  const tool = useAtomValue(ribbonToolAtom);
  const standaloneBbox = useAtomValue(terrainStandaloneBboxAtom);
  // Only the standalone entrance can re-frame; with a lokalitet open the
  // rectangle is the lokalitet's, and "Juster området" in the lokalitet row
  // owns it.
  const { frame } = useTerrainViewport();

  // Which rectangle is being analysed, or null when the tool is not up. The
  // lokalitet's own bbox rather than a copy: that is what makes "Juster
  // området" refetch the DEM for free.
  const bbox: LocalityBbox | null = locality
    ? tool === 'terrain'
      ? locality.bbox
      : null
    : standaloneBbox;

  const [model, setModel] = useState<DemModel>('dtm');
  const [dem, setDem] = useState<Dem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'failed' | 'empty' | null>(null);

  const [vis, setVis] = useState<Visualization>('hillshade');
  const [azimuth, setAzimuth] = useState(DEFAULT_AZIMUTH);
  const [altitude, setAltitude] = useState(DEFAULT_ALTITUDE);
  const [zFactor, setZFactor] = useState(DEFAULT_Z_FACTOR);
  // Percent, mirrored onto the layer imperatively — see terrainOverlayLayer.
  const [opacity, setOpacity] = useState(100);

  // One radius each rather than one shared: they are different quantities
  // measured in the same unit — how far to smooth before subtracting, versus
  // how far to look for a horizon — and a good value for one is a poor value
  // for the other, so switching views must not carry the number across.
  const [lrmRadius, setLrmRadius] = useState(DEFAULT_LRM_RADIUS);
  const [svfRadius, setSvfRadius] = useState(DEFAULT_SVF_RADIUS);
  // Exposed already clamped, so the slider's thumb, the number beside it, the
  // render and the caption are the same value. The *stored* number is left
  // alone: a 20 m sky-view radius that a 0.25 m grid caps at 6 m should come
  // back at 20 m over a 1 m one, not be quietly rewritten on the way past.
  const rawRadius = vis === 'svf' ? svfRadius : lrmRadius;
  const radius = dem ? clampRadius(vis, dem, rawRadius) : rawRadius;
  const setRadius = useCallback(
    (value: number) => (vis === 'svf' ? setSvfRadius : setLrmRadius)(value),
    [vis],
  );

  const [saving, setSaving] = useState(false);
  // Off-DOM: this canvas is the layer's image and the blob "Lagre" keeps, and
  // it is never shown in a row. React does not own it either — the OL source
  // draws from this exact element.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const bboxKey = bbox ? bbox.join(',') : null;

  // Fetch the DEM whenever the rectangle or the model changes. The abort
  // matters: resizing a lokalitet can retrigger this while several
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
    // bboxKey rather than bbox: the array is a fresh identity on every
    // record update, which would refetch on an unrelated rename.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bboxKey, model]);

  // Expensive, sun-independent passes. Keyed so that dragging the azimuth
  // slider — which happens dozens of times a second — can never retrigger a
  // multi-second sky-view factor. The two memos are split for that reason
  // alone; see render.ts. Radius is the one knob that lands on *this* side of
  // the line, which is why its slider commits on release instead of streaming
  // like the other four (TerrainSliders).
  const staticField = useMemo(
    () => (dem ? terrainStaticField(dem, vis, radius) : null),
    [dem, vis, radius],
  );

  // What the radius slider may offer, or null for the three views that have
  // no radius. Grid-dependent for sky-view factor — see radiusRange.
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

  // Paint, then hand the canvas to the map.
  useEffect(() => {
    if (!dem || !field) {
      // Covers loading, the no-coverage case, a failed fetch and leaving the
      // tool alike: an earlier render must not stay on the map describing
      // ground nothing is analysing any more.
      hideTerrainOverlay();
      return;
    }
    // Reused rather than recreated: this exact element is what the map's
    // image source draws from, so replacing it every slider frame would mean
    // rebuilding the layer's image too.
    const canvas = (canvasRef.current ??= document.createElement('canvas'));
    if (!paintTerrainField(field, dem, vis, canvas)) return;
    showTerrainOverlay({ canvas, extent25833: demImageExtent(dem) });
  }, [dem, field, vis]);

  // After the paint effect on purpose: on the commit that first builds the
  // layer, this is what gives it the slider's own position rather than
  // whatever a previous session of the tool left behind.
  useEffect(() => {
    setTerrainOverlayOpacity(opacity / 100);
  }, [opacity]);

  // Unmounting the ribbon takes the layer with it.
  useEffect(() => hideTerrainOverlay, []);

  const save = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !dem || !bbox || saving) return;
    // Signed out is a normal state here — the whole point of Terreng in row 1
    // is that reading the ground needs no account. Only keeping the render
    // does.
    if (!user) {
      openAuthDialog(true);
      return;
    }
    setSaving(true);
    try {
      // No lokalitet yet: the analysed rectangle becomes one. Deliberately
      // `bbox` and not the current view — the map is live under the ribbon,
      // so the user has probably panned since pressing Terreng.
      //
      // Before the render rather than after, so the figure's title can carry
      // the name the registers just gave the rectangle.
      let target = locality;
      if (!target) {
        target = await createLocalityFromBbox(
          bbox,
          user.id,
          t('localities.defaultName'),
        );
        if (!target) {
          toast.error({ title: t('localities.createFailed') });
          return;
        }
      }

      // What leaves the app is a figure, not a screengrab of the overlay:
      // a hillshade at 315°/35° and one at 135°/20° disagree about whether
      // there is a mound in that field, so the angles travel with the pixels.
      const figure = await renderFigureBlob(
        canvas,
        terrainFigure({
          subject: target.name || undefined,
          vis,
          model,
          light: { azimuth, altitude, zFactor },
          dem,
          radius,
        }),
      );
      if (!figure) return;

      const label = t(`localities.terrain.vis.${vis}`);
      await createAttachment(
        {
          locality: target.id,
          // Reuses the existing `extract` kind rather than adding one: this
          // is a LiDAR-derived raster of the rectangle, which is what that
          // kind already means, and a new enum value would need a
          // PocketBase migration for no user-visible gain.
          kind: 'extract',
          caption: `${label} · ${model.toUpperCase()}`,
          meta: {
            sourceLabel: t('localities.terrain.sourceLabel'),
            style: vis,
            model,
            metresPerPx: dem.metresPerPx,
            bbox25833: dem.bbox25833,
            // Where the render sits inside the file: the caption panel is
            // drawn below it, so the image is no longer the whole PNG.
            imageRect: figure.imageRect,
            // Only meaningful for the sun-dependent views, but recording it
            // unconditionally keeps the shape predictable.
            ...(vis === 'hillshade' ? { azimuth } : {}),
            altitude,
            zFactor,
            // Already clamped to the grid — see above.
            ...(radiusLimits ? { radius } : {}),
          },
        },
        user.id,
        figure.blob,
        `terreng_${vis}_${model}.png`,
      );

      // Opening the new lokalitet is the receipt: the ribbon rescopes to it
      // and the render is sitting in its Bilder.
      if (!locality) setActiveLocality(target);
    } catch (e) {
      console.warn('[terrain] save failed', e);
      toast.error({ title: t('localities.terrain.saveFailed') });
    } finally {
      setSaving(false);
    }
  }, [
    locality,
    bbox,
    user,
    openAuthDialog,
    setActiveLocality,
    saving,
    vis,
    model,
    dem,
    azimuth,
    altitude,
    zFactor,
    radius,
    radiusLimits,
    t,
  ]);

  return {
    hasLocality: locality != null,
    frame,
    model,
    setModel,
    vis,
    setVis,
    dem,
    loading,
    error,
    saving,
    save,
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
