import type {
  EvidenceKind,
  EvidenceMeta,
  EvidenceRecord,
} from '../api/evidence';
import {
  CVAT_STYLE,
  type LidarModel,
} from '../map/layers/config/backgroundLayers/lidarProjects';
import { serviceOn } from '../services';
import type { DemModel } from '../terrain/dem';
import { DEFAULT_ALTITUDE, DEFAULT_Z_FACTOR } from '../terrain/render';
import { VISUALIZATIONS, type Visualization } from '../terrain/shade';

export const NIB_MOSAIC = 'mosaic';

export const AUTO_SOURCE = 'auto';

const SUNLOOP_STEP_DEG = 5;
const SUNLOOP_FPS = 24;

export const RVT_BLENDS = ['e4mstp'] as const;

export type RvtBlend = (typeof RVT_BLENDS)[number];

export type EvidenceSpec =
  | {
      kind: 'lidar';

      sourceKey: string;
      sourceLabel: string;

      style: string;
      model: LidarModel;
      year: number | null;
      pointDensity: string | null;
    }
  | {
      kind: 'terrain';
      vis: Visualization;
      model: DemModel;

      azimuth: number;
      altitude: number;
      zFactor: number;

      radius: number;
    }
  | {
      kind: 'flyfoto';

      projectId: string;
      projectName: string | null;
      year: number | null;
      photoDate: string | null;
    }
  | {

      kind: 'sunloop';
      model: DemModel;

      source: string;
      altitude: number;
      zFactor: number;
      stepDeg: number;
      fps: number;
    }
  | {

      kind: 'rvt';
      vis: RvtBlend;
      model: DemModel;

      source: string;
    };

export const SUN_LOOP_DEFAULTS = {
  altitude: DEFAULT_ALTITUDE,
  zFactor: DEFAULT_Z_FACTOR,
  stepDeg: SUNLOOP_STEP_DEG,
};

export type SunLoopSettings = typeof SUN_LOOP_DEFAULTS;

export const sunLoopSpec = (
  source: string,
  settings: SunLoopSettings,
): Extract<EvidenceSpec, { kind: 'sunloop' }> => ({
  kind: 'sunloop',
  model: 'dtm',
  source,
  fps: SUNLOOP_FPS,
  ...settings,
});

export const rvtSpec = (
  vis: RvtBlend,
  source: string,
): Extract<EvidenceSpec, { kind: 'rvt' }> => ({
  kind: 'rvt',
  vis,
  model: 'dtm',
  source,
});

export const rendersOnServer = (kind: EvidenceKind): boolean =>
  kind === 'sunloop' || kind === 'rvt';

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;

const asVis = (v: unknown): Visualization | null =>
  typeof v === 'string' && (VISUALIZATIONS as readonly string[]).includes(v)
    ? (v as Visualization)
    : null;

const asModel = (v: unknown): DemModel | null =>
  v === 'dtm' || v === 'dom' ? v : null;

const asBlend = (v: unknown): RvtBlend | null =>
  typeof v === 'string' && (RVT_BLENDS as readonly string[]).includes(v)
    ? (v as RvtBlend)
    : null;

export const metaOf = (spec: EvidenceSpec): EvidenceMeta => {
  switch (spec.kind) {
    case 'lidar':
      return {
        sourceKey: spec.sourceKey,
        sourceLabel: spec.sourceLabel,
        style: spec.style,
        model: spec.model,
        year: spec.year,
        pointDensity: spec.pointDensity,
      };
    case 'terrain':
      return {
        vis: spec.vis,
        model: spec.model,
        azimuth: spec.azimuth,
        altitude: spec.altitude,
        zFactor: spec.zFactor,
        radius: spec.radius,
      };
    case 'flyfoto':
      return {
        projectId: spec.projectId,
        projectName: spec.projectName,
        year: spec.year,
        photoDate: spec.photoDate,
      };
    case 'sunloop':
      return {
        model: spec.model,
        source: spec.source,
        altitude: spec.altitude,
        zFactor: spec.zFactor,
        stepDeg: spec.stepDeg,
        fps: spec.fps,
      };
    case 'rvt':
      return { vis: spec.vis, model: spec.model, source: spec.source };
  }
};

export const specOf = (rec: EvidenceRecord): EvidenceSpec | null => {
  const meta = rec.meta;
  if (!meta) return null;

  switch (rec.kind) {
    case 'lidar': {
      const sourceKey = str(meta.sourceKey);
      const style = str(meta.style);
      const model = asModel(meta.model);
      if (!sourceKey || !style || !model) return null;
      return {
        kind: 'lidar',
        sourceKey,
        sourceLabel: str(meta.sourceLabel) ?? sourceKey,
        style,
        model,
        year: num(meta.year),
        pointDensity: str(meta.pointDensity),
      };
    }
    case 'terrain': {
      const vis = asVis(meta.vis);
      const model = asModel(meta.model);
      if (!vis || !model) return null;
      return {
        kind: 'terrain',
        vis,
        model,
        azimuth: num(meta.azimuth) ?? 0,
        altitude: num(meta.altitude) ?? 0,
        zFactor: num(meta.zFactor) ?? 1,
        radius: num(meta.radius) ?? 0,
      };
    }
    case 'flyfoto': {
      const projectId = str(meta.projectId) ?? NIB_MOSAIC;
      return {
        kind: 'flyfoto',
        projectId,
        projectName: str(meta.projectName),
        year: num(meta.year),
        photoDate: str(meta.photoDate),
      };
    }
    case 'sunloop': {
      const model = asModel(meta.model);
      if (!model) return null;
      return {
        kind: 'sunloop',
        model,

        source: str(meta.source) ?? AUTO_SOURCE,
        altitude: num(meta.altitude) ?? 0,
        zFactor: num(meta.zFactor) ?? 1,
        stepDeg: num(meta.stepDeg) ?? SUNLOOP_STEP_DEG,
        fps: num(meta.fps) ?? SUNLOOP_FPS,
      };
    }
    case 'rvt': {
      const vis = asBlend(meta.vis);
      const model = asModel(meta.model);

      if (!vis || !model) return null;
      return {
        kind: 'rvt',
        vis,
        model,
        source: str(meta.source) ?? AUTO_SOURCE,
      };
    }
  }
};

export const evidenceRenderable = (rec: EvidenceRecord): boolean => {
  const spec = specOf(rec);
  if (!spec) return false;
  if (spec.kind === 'flyfoto') return serviceOn('flyfoto');
  if (spec.kind === 'lidar')
    return spec.style !== CVAT_STYLE || serviceOn('cvat');
  return true;
};

export const evidenceBbox = (
  rec: EvidenceRecord,
): [number, number, number, number] | null => bboxOfMeta(rec.meta);

export const bboxOfMeta = (
  meta: EvidenceMeta | null,
): [number, number, number, number] | null => {
  const raw = meta?.bbox25833;
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const out = raw.map(num);
  return out.every((v) => v != null)
    ? (out as [number, number, number, number])
    : null;
};

export const evidenceBandTop = (rec: EvidenceRecord): number => {
  const value = num(rec.meta?.bandTop);
  return value != null && value > 0 && value <= 1 ? value : 1;
};

export const evidenceResolution = (rec: EvidenceRecord): number | null =>
  num(rec.meta?.metresPerPx);

export const isReadable = (rec: EvidenceRecord): boolean =>
  rec.file !== '' && evidenceBbox(rec) !== null;

export const isVideoEvidence = (rec: EvidenceRecord): boolean =>
  rec.kind === 'sunloop';

export const coverOf = (
  rows: readonly EvidenceRecord[],
): EvidenceRecord | null => rows.find(isReadable) ?? null;

export const loopStepDeg = (rec: EvidenceRecord): number => {
  const spec = specOf(rec);
  return spec?.kind === 'sunloop' ? spec.stepDeg : SUNLOOP_STEP_DEG;
};

const BBOX_TOLERANCE_M = 1;

const PARAM_TOLERANCE = 1e-6;

const sameBbox = (a: [number, number, number, number], b: unknown): boolean =>
  Array.isArray(b) &&
  b.length === 4 &&
  a.every((v, i) => {
    const other = num(b[i]);
    return other != null && Math.abs(v - other) <= BBOX_TOLERANCE_M;
  });

const sameNumber = (a: number, b: number) => Math.abs(a - b) <= PARAM_TOLERANCE;

export const evidenceMatches = (
  rec: EvidenceRecord,
  spec: EvidenceSpec,
  bbox25833: [number, number, number, number],
): boolean => {
  if (rec.kind !== spec.kind) return false;
  if (!sameBbox(bbox25833, rec.meta?.bbox25833)) return false;
  const stored = specOf(rec);
  if (!stored) return false;

  switch (spec.kind) {
    case 'lidar':
      return (
        stored.kind === 'lidar' &&
        stored.sourceKey === spec.sourceKey &&
        stored.style === spec.style &&
        stored.model === spec.model
      );
    case 'terrain':
      return (
        stored.kind === 'terrain' &&
        stored.vis === spec.vis &&
        stored.model === spec.model &&
        sameNumber(stored.azimuth, spec.azimuth) &&
        sameNumber(stored.altitude, spec.altitude) &&
        sameNumber(stored.zFactor, spec.zFactor) &&
        sameNumber(stored.radius, spec.radius)
      );
    case 'flyfoto':
      return stored.kind === 'flyfoto' && stored.projectId === spec.projectId;
    case 'sunloop':
      return (
        stored.kind === 'sunloop' &&
        stored.model === spec.model &&
        stored.source === spec.source &&
        sameNumber(stored.altitude, spec.altitude) &&
        sameNumber(stored.zFactor, spec.zFactor) &&
        stored.stepDeg === spec.stepDeg &&
        stored.fps === spec.fps
      );
    case 'rvt':
      return (
        stored.kind === 'rvt' &&
        stored.vis === spec.vis &&
        stored.model === spec.model &&
        stored.source === spec.source
      );
  }
};
