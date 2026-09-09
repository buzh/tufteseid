// The lokalitet workspace's "Terreng" tool: pull the float DEM for the
// rectangle once, then re-light and re-process it locally, so azimuth is
// a slider over data already in memory rather than a new WMS request.
//
// Why that matters: docs/terrain-analysis.md. The control surface and the
// two deliberately-split useMemos: docs/ui-architecture.md §10.

import { Box, Button, HStack, Spinner, Text, VStack } from '@kvib/react';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createAttachment } from '../api/attachments';
import { currentUserAtom } from '../auth/atoms';
import { activeLocalityAtom } from '../localities/atoms';
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

const VISUALIZATIONS: Visualization[] = [
  'hillshade',
  'multiHillshade',
  'svf',
  'lrm',
  'slope',
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

export const TerrainPanel = () => {
  const { t } = useTranslation();
  const locality = useAtomValue(activeLocalityAtom);
  const user = useAtomValue(currentUserAtom);

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

  const bboxKey = locality && `${locality.id}:${locality.bbox.join(',')}`;

  // Fetch the DEM whenever the rectangle or the model changes. The abort
  // matters: resizing a lokalitet can retrigger this while several
  // megabytes are still in flight.
  useEffect(() => {
    if (!locality) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDem(null);
    fetchDem(locality.bbox, { model, signal: controller.signal })
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
    // bboxKey rather than locality.bbox: the array is a fresh identity on
    // every record update, which would refetch on an unrelated rename.
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
    ctx.putImageData(toImageData(field, dem.width, dem.height, ramp, range), 0, 0);
  }, [dem, field, vis]);

  const save = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !locality || !user || saving) return;
    setSaving(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      );
      if (!blob) return;
      const label = t(`localities.terrain.vis.${vis}`);
      await createAttachment(
        {
          locality: locality.id,
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
    } catch (e) {
      console.warn('[TerrainPanel] save failed', e);
    } finally {
      setSaving(false);
    }
  }, [locality, user, saving, vis, model, dem, azimuth, altitude, zFactor, t]);

  if (!locality) return null;

  const sunDependent = vis === 'hillshade';
  const usesZFactor = vis !== 'svf' && vis !== 'lrm';

  return (
    <VStack align="stretch" gap={3}>
      <HStack gap={1}>
        {(['dtm', 'dom'] as DemModel[]).map((m) => (
          <Button
            key={m}
            size="xs"
            flex="1"
            variant={model === m ? 'primary' : 'secondary'}
            colorPalette="green"
            onClick={() => setModel(m)}
          >
            {m.toUpperCase()}
          </Button>
        ))}
      </HStack>

      <Box>
        <Text fontSize="xs" color="gray.600" mb={1}>
          {t('localities.terrain.visualization')}
        </Text>
        <HStack gap={1} wrap="wrap">
          {VISUALIZATIONS.map((v) => (
            <Button
              key={v}
              size="xs"
              variant={vis === v ? 'primary' : 'secondary'}
              colorPalette="green"
              onClick={() => setVis(v)}
            >
              <Text fontSize="11px">{t(`localities.terrain.vis.${v}`)}</Text>
            </Button>
          ))}
        </HStack>
        <Text fontSize="11px" color="gray.500" mt={1}>
          {t(`localities.terrain.visHint.${vis}`)}
        </Text>
      </Box>

      <Box
        borderWidth="1px"
        borderColor="gray.200"
        borderRadius="md"
        overflow="hidden"
        bg="gray.50"
        minH="120px"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        {loading && <Spinner size="sm" />}
        {!loading && error && (
          <Text fontSize="sm" color="gray.600" p={4} textAlign="center">
            {t(`localities.terrain.${error}`)}
          </Text>
        )}
        <canvas
          ref={canvasRef}
          style={{
            display: loading || error ? 'none' : 'block',
            width: '100%',
            height: 'auto',
            // The DEM grid is already at or near native resolution; letting
            // the browser smooth it on upscale hides exactly the
            // single-pixel detail we're looking for.
            imageRendering: 'pixelated',
          }}
        />
      </Box>

      {dem && !loading && (
        <VStack align="stretch" gap={2}>
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

          <HStack justify="space-between" gap={2}>
            <Text fontSize="11px" color="gray.500">
              {t('localities.terrain.resolution', {
                m: dem.metresPerPx.toFixed(2),
                w: dem.width,
                h: dem.height,
              })}
            </Text>
            <Button
              size="xs"
              variant="secondary"
              colorPalette="green"
              disabled={saving || !user}
              onClick={save}
            >
              {saving
                ? t('localities.terrain.saving')
                : t('localities.terrain.save')}
            </Button>
          </HStack>
        </VStack>
      )}
    </VStack>
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
  <Box>
    <HStack justify="space-between" mb={0.5}>
      <Text fontSize="11px" color="gray.600">
        {label}
      </Text>
      <Text fontSize="11px" color="gray.500">
        {value}
        {suffix}
      </Text>
    </HStack>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: '100%' }}
    />
  </Box>
);
