// Terrenganalyse: pull the float DEM for a rectangle once, then re-light and
// re-process it locally, so azimuth is a slider over data already in memory
// rather than a new WMS request.
//
// Two entrances share this panel, which is why the lokalitet is a nullable
// prop rather than an atom read. A lokalitet's "Terreng" verb analyses its
// rectangle and saves into its Bilder; row 1's "Terreng" analyses the visible
// map with nothing open at all, and turns that rectangle into a lokalitet on
// the way out.
//
// Why any of this: docs/terrain-analysis.md. The control surface and the two
// deliberately-split useMemos: docs/ui-architecture.md §10.

import { toaster } from '@kvib/react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createAttachment } from '../api/attachments';
import type { LocalityBbox, LocalityRecord } from '../api/localities';
import { currentUserAtom } from '../auth/atoms';
import { isAuthDialogOpenAtom } from '../auth/atoms-dialog';
import { activeLocalityAtom } from '../localities/atoms';
import { createLocalityFromBbox } from '../localities/createFromBbox';
import { Button, Segmented, Spinner, type SegmentedOption } from '../ui';
import { fetchDem, type Dem, type DemModel } from './dem';
import {
  computeHillshade,
  computeLrm,
  computeMultiHillshade,
  computeSlope,
  computeSvf,
  percentileRange,
  toImageData,
  type Ramp,
  type Visualization,
} from './shade';
import styles from './TerrainPanel.module.css';

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

// Only the sun-dependent views react to these, which is why they're split
// from the expensive memo below.
const DEFAULT_AZIMUTH = 315;
const DEFAULT_ALTITUDE = 35;
const DEFAULT_Z_FACTOR = 2;

// Metres. The LRM smoothing radius has to be comfortably larger than the
// features being hunted or it removes them along with the landform trend;
// 15 m suits mounds and ditches.
const DEFAULT_LRM_RADIUS = 15;
const DEFAULT_SVF_RADIUS = 20;

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

  const [model, setModel] = useState<DemModel>('dtm');
  const [dem, setDem] = useState<Dem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'failed' | 'empty' | null>(null);

  const [vis, setVis] = useState<Visualization>('hillshade');
  const [azimuth, setAzimuth] = useState(DEFAULT_AZIMUTH);
  const [altitude, setAltitude] = useState(DEFAULT_ALTITUDE);
  const [zFactor, setZFactor] = useState(DEFAULT_Z_FACTOR);

  const [saving, setSaving] = useState(false);
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
  // multi-second sky-view factor.
  const staticField = useMemo(() => {
    if (!dem) return null;
    if (vis === 'svf') return computeSvf(dem, DEFAULT_SVF_RADIUS);
    if (vis === 'lrm') return computeLrm(dem, DEFAULT_LRM_RADIUS);
    return null;
  }, [dem, vis]);

  const field = useMemo(() => {
    if (!dem) return null;
    switch (vis) {
      case 'hillshade':
        return computeHillshade(dem, azimuth, altitude, zFactor);
      case 'multiHillshade':
        return computeMultiHillshade(dem, altitude, zFactor);
      case 'slope':
        return computeSlope(dem, zFactor);
      default:
        return staticField;
    }
  }, [dem, vis, azimuth, altitude, zFactor, staticField]);

  // Paint. Ranges differ per visualization: the shaded ones are already
  // normalised to 0..1, the physical ones need a robust stretch because a
  // single spike or the flat 0.0 plane over water would otherwise swallow
  // the whole ramp.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !dem || !field) return;
    canvas.width = dem.width;
    canvas.height = dem.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let ramp: Ramp = 'grey';
    let range: [number, number] = [0, 1];
    if (vis === 'slope') {
      ramp = 'greyInverted';
      range = [0, percentileRange(field, 0.02, 0.98)[1]];
    } else if (vis === 'svf') {
      range = percentileRange(field, 0.02, 0.98);
    } else if (vis === 'lrm') {
      ramp = 'diverging';
      // Symmetric about zero, or the neutral tone drifts off the "no local
      // relief" value and two renders stop being comparable.
      const [lo, hi] = percentileRange(field, 0.02, 0.98);
      const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
      range = [-m, m];
    }
    ctx.putImageData(
      toImageData(field, dem.width, dem.height, ramp, range),
      0,
      0,
    );
  }, [dem, field, vis]);

  const save = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || saving) return;
    // Signed out is a normal state here — the whole point of Terreng in row 1
    // is that reading the ground needs no account. Only keeping the render
    // does.
    if (!user) {
      openAuthDialog(true);
      return;
    }
    setSaving(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      );
      if (!blob) return;

      // No lokalitet yet: the analysed rectangle becomes one. Deliberately
      // `bbox` and not the current view — the map is live underneath this
      // panel, so the user has probably panned since pressing Terreng.
      let target = locality;
      if (!target) {
        target = await createLocalityFromBbox(
          bbox,
          user.id,
          t('localities.defaultName'),
        );
        if (!target) {
          toaster.error({ title: t('localities.createFailed') });
          return;
        }
      }

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
            metresPerPx: dem?.metresPerPx,
            bbox25833: dem?.bbox25833,
            // Only meaningful for the sun-dependent views, but recording it
            // unconditionally keeps the shape predictable.
            ...(vis === 'hillshade' ? { azimuth } : {}),
            altitude,
            zFactor,
          },
        },
        user.id,
        blob,
        `terreng_${vis}_${model}.png`,
      );

      // Opening the new lokalitet is the receipt: the ribbon rescopes to it
      // and the render is sitting in its Bilder. (That also unmounts this
      // panel, since the standalone rectangle is cleared with it.)
      if (!locality) setActiveLocality(target);
    } catch (e) {
      console.warn('[TerrainPanel] save failed', e);
      toaster.error({ title: t('localities.terrain.saveFailed') });
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
      {/* Capped by the wrapper and letterboxed, not scaled to fit the row: a
          3000 px DEM at width:100% would make the ribbon several screens
          tall. */}
      <div className={styles.preview}>
        {loading && <Spinner size={20} />}
        {!loading && error && (
          <p className={styles.message}>{t(`localities.terrain.${error}`)}</p>
        )}
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          style={{ display: loading || error ? 'none' : 'block' }}
        />
      </div>

      <div className={styles.controls}>
        <div className={styles.pickers}>
          <Segmented
            value={vis}
            options={visOptions}
            onChange={setVis}
            label={t('localities.terrain.visualization')}
          />
          <Segmented
            value={model}
            options={MODEL_OPTIONS}
            onChange={setModel}
            label={t('ribbon.lidar.modelLabel')}
          />
        </div>

        <p className={styles.hint}>{t(`localities.terrain.visHint.${vis}`)}</p>

        {dem && !loading && (
          <>
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
            </div>

            <div className={styles.footer}>
              <span className={styles.meta}>
                {t('localities.terrain.resolution', {
                  m: dem.metresPerPx.toFixed(2),
                  w: dem.width,
                  h: dem.height,
                })}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={saving}
                onClick={save}
              >
                {saving
                  ? t('localities.terrain.saving')
                  : locality
                    ? t('localities.terrain.save')
                    : t('localities.terrain.saveNew')}
              </Button>
            </div>
          </>
        )}
      </div>
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
