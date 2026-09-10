// Terrenganalyse: pull the float DEM for a rectangle once, then re-light and
// re-process it locally, so azimuth is a slider over data already in memory
// rather than a new WMS request.
//
// The render goes on the **map**, not in this row — `terrainOverlayLayer.ts`
// puts the canvas down as a georeferenced image layer over the background, so
// scrubbing the light re-lights the ground in place, under the Kulturminner
// layers and the lokalitet's own drawing. What is left here is only the
// knobs, which is why the row is a couple of lines tall and lets the map
// through.
//
// Two entrances share this panel, which is why the lokalitet is a nullable
// prop rather than an atom read. A lokalitet's "Terreng" verb analyses its
// rectangle and saves into its Bilder; row 1's "Terreng" analyses the visible
// map with nothing open at all, and turns that rectangle into a lokalitet on
// the way out.
//
// Why any of this: docs/terrain-analysis.md. The control surface and the two
// deliberately-split useMemos: docs/ui-architecture.md §10.

import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createAttachment } from '../api/attachments';
import type { LocalityBbox, LocalityRecord } from '../api/localities';
import { currentUserAtom } from '../auth/atoms';
import { isAuthDialogOpenAtom } from '../auth/atoms-dialog';
import { renderFigureBlob } from '../figure/figure';
import { terrainFigure } from '../figure/specs';
import { activeLocalityAtom } from '../localities/atoms';
import { createLocalityFromBbox } from '../localities/createFromBbox';
import {
  Button,
  Segmented,
  Spinner,
  toast,
  type SegmentedOption,
} from '../ui';
import { fetchDem, type Dem, type DemModel } from './dem';
import {
  DEFAULT_ALTITUDE,
  DEFAULT_AZIMUTH,
  DEFAULT_Z_FACTOR,
  demImageExtent,
  paintTerrainField,
  terrainField,
  terrainStaticField,
} from './render';
import { type Visualization } from './shade';
import styles from './TerrainPanel.module.css';
import {
  hideTerrainOverlay,
  setTerrainOverlayOpacity,
  showTerrainOverlay,
} from './terrainOverlayLayer';
import { useTerrainViewport } from './useTerrainViewport';

const VISUALIZATIONS: Visualization[] = [
  'hillshade',
  'multiHillshade',
  'svf',
  'lrm',
  'slope',
];

const MODEL_OPTIONS: SegmentedOption<DemModel>[] = [
  { value: 'dtm', label: 'DTM' },
  { value: 'dom', label: 'DOM' },
];

export const TerrainPanel = ({
  bbox,
  locality,
}: {
  bbox: LocalityBbox;
  /** The lokalitet the rectangle belongs to, or null when analysing the map. */
  locality: LocalityRecord | null;
}) => {
  const { t } = useTranslation();
  const user = useAtomValue(currentUserAtom);
  const openAuthDialog = useSetAtom(isAuthDialogOpenAtom);
  const setActiveLocality = useSetAtom(activeLocalityAtom);
  // Only the standalone entrance can re-frame; with a lokalitet open the
  // rectangle is the lokalitet's, and "Juster området" in the lokalitet row
  // owns it.
  const { frame } = useTerrainViewport();

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

  const [saving, setSaving] = useState(false);
  // Off-DOM: this canvas is the layer's image and the blob "Lagre" keeps, and
  // it is never shown in the row. React does not own it either — the OL
  // source draws from this exact element.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const bboxKey = bbox.join(',');

  // Fetch the DEM whenever the rectangle or the model changes. The abort
  // matters: resizing a lokalitet can retrigger this while several
  // megabytes are still in flight.
  useEffect(() => {
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
  // alone; see render.ts.
  const staticField = useMemo(
    () => (dem ? terrainStaticField(dem, vis) : null),
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
      // Covers loading, the no-coverage case and a failed fetch alike: an
      // earlier render must not stay on the map describing ground the panel
      // is no longer analysing.
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
  // layer, this is what gives it the panel's own slider position rather than
  // whatever a previous session of the tool left behind.
  useEffect(() => {
    setTerrainOverlayOpacity(opacity / 100);
  }, [opacity]);

  // Closing the row, or swapping entrances, takes the layer with it.
  useEffect(() => hideTerrainOverlay, []);

  const save = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !dem || saving) return;
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
      // `bbox` and not the current view — the map is live underneath this
      // panel, so the user has probably panned since pressing Terreng.
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
          },
        },
        user.id,
        figure.blob,
        `terreng_${vis}_${model}.png`,
      );

      // Opening the new lokalitet is the receipt: the ribbon rescopes to it
      // and the render is sitting in its Bilder. (That also unmounts this
      // panel, since the standalone rectangle is cleared with it.)
      if (!locality) setActiveLocality(target);
    } catch (e) {
      console.warn('[TerrainPanel] save failed', e);
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
    t,
  ]);

  const sunDependent = vis === 'hillshade';
  const usesZFactor = vis !== 'svf' && vis !== 'lrm';

  const visOptions: SegmentedOption<Visualization>[] = VISUALIZATIONS.map(
    (v) => ({ value: v, label: t(`localities.terrain.vis.${v}`) }),
  );

  return (
    <div className={styles.root}>
      <div className={styles.top}>
        {/* Five long Norwegian words in a 360 px column: this one has to be
            allowed onto a second line, or the dock's overflow eats the last
            two options. */}
        <Segmented
          value={vis}
          options={visOptions}
          onChange={setVis}
          wrap
          label={t('localities.terrain.visualization')}
        />
        <Segmented
          value={model}
          options={MODEL_OPTIONS}
          onChange={setModel}
          label={t('ribbon.lidar.modelLabel')}
        />

        <div className={styles.spacer} />

        <div className={styles.status}>
          {loading && <Spinner size={16} />}
          {!loading && error && (
            <span className={styles.error}>
              {t(`localities.terrain.${error}`)}
            </span>
          )}
          {/* Two readings, because "0,50 m/px" alone doesn't say whether
              that is all the laser data there is or the grid cap biting.
              Only the second is actionable — shrink the rectangle and you
              get more detail — so it's the one that names the source. */}
          {!loading && !error && dem && (
            <span>
              {dem.metresPerPx > dem.nativeMetresPerPx * 1.05
                ? t('localities.terrain.resolutionCapped', {
                    m: dem.metresPerPx.toFixed(2),
                    w: dem.width,
                    h: dem.height,
                    src: dem.nativeMetresPerPx.toFixed(2),
                  })
                : t('localities.terrain.resolution', {
                    m: dem.metresPerPx.toFixed(2),
                    w: dem.width,
                    h: dem.height,
                  })}
            </span>
          )}
        </div>

        {/* On their own line in the dock's column: two full-length Norwegian
            verbs will not share one with the pickers, and left to wrap
            individually they arrive at different times as the panel reflows. */}
        <div className={styles.actions}>
          {/* Moves the analysed rectangle onto the map as it now stands. The
              bbox is deliberately held rather than tracking the view — the DEM
              behind it is a real download, not a tile request — so panning off
              it is a normal move, and this is how you bring the analysis back
              to what you are looking at. Only offered without a lokalitet:
              with one the rectangle is the lokalitet's, and "Juster området"
              owns it. */}
          {!locality && (
            <Button
              size="sm"
              variant="ghost"
              leftIcon="filter_center_focus"
              title={t('localities.terrain.reframeHint')}
              onClick={frame}
            >
              {t('localities.terrain.reframe')}
            </Button>
          )}
          {/* The verbs stay put through a reload rather than appearing with
              the render, so the row does not reflow under the pointer — but
              there is nothing to keep until a DEM is painted, and the canvas
              may still be holding the previous rectangle. */}
          <Button
            size="sm"
            variant="secondary"
            disabled={saving || loading || !dem}
            onClick={save}
          >
            {saving
              ? t('localities.terrain.saving')
              : locality
                ? t('localities.terrain.save')
                : t('localities.terrain.saveNew')}
          </Button>
        </div>
      </div>

      {dem && !loading && (
        <div className={styles.sliders}>
          {sunDependent && (
            <SliderRow
              label={t('localities.terrain.azimuth')}
              value={azimuth}
              min={0}
              max={359}
              step={1}
              suffix="°"
              onChange={setAzimuth}
            />
          )}
          {(sunDependent || vis === 'multiHillshade') && (
            <SliderRow
              label={t('localities.terrain.altitude')}
              value={altitude}
              min={5}
              max={85}
              step={1}
              suffix="°"
              onChange={setAltitude}
            />
          )}
          {usesZFactor && (
            <SliderRow
              label={t('localities.terrain.zFactor')}
              value={zFactor}
              min={1}
              max={8}
              step={0.5}
              suffix="×"
              onChange={setZFactor}
            />
          )}
          {/* Fades the render towards whatever it is covering, which is the
              only way to check a suspected feature against the ortofoto or
              the topo map without losing the light you just dialled in. */}
          <SliderRow
            label={t('localities.terrain.opacity')}
            value={opacity}
            min={0}
            max={100}
            step={5}
            suffix="%"
            onChange={setOpacity}
          />
        </div>
      )}

      <p className={styles.hint}>{t(`localities.terrain.visHint.${vis}`)}</p>
    </div>
  );
};

// A plain range input rather than a kvib/Chakra slider: this needs a
// continuous `onInput` stream to sweep the light smoothly, and the value is
// rendered next to the label anyway.
const SliderRow = ({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (v: number) => void;
}) => (
  <div className={styles.slider}>
    <div className={styles.sliderHead}>
      <span>{label}</span>
      <span className={styles.sliderValue}>
        {value}
        {suffix}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  </div>
);
