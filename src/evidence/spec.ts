import type {
  EvidenceKind,
  EvidenceMeta,
  EvidenceRecord,
} from '../api/evidence';
import type { LidarModel } from '../map/layers/config/backgroundLayers/lidarProjects';
import type { DemModel } from '../terrain/dem';
import { DEFAULT_ALTITUDE, DEFAULT_Z_FACTOR } from '../terrain/render';
import { VISUALIZATIONS, type Visualization } from '../terrain/shade';

/** The seamless best-available mosaic, as against one acquisition. */
export const NIB_MOSAIC = 'mosaic';

/** Degrees between frames. Must divide 360, or the loop jumps where it closes;
 *  the sidecar refuses one that does not. */
const SUNLOOP_STEP_DEG = 5;
const SUNLOOP_FPS = 24;

/** The RVT blends the sidecar can make. Mirrors the `PRODUCERS` table in
 *  `rendersvc/blends.py`, and each name is a key under `evidence.rvt` in the
 *  locale files. */
export const RVT_BLENDS = ['e4mstp'] as const;

export type RvtBlend = (typeof RVT_BLENDS)[number];

export type EvidenceSpec =
  | {
      kind: 'lidar';
      /** `national`, or `project:<prosjektnavn>`: the catalogue's own key. */
      sourceKey: string;
      sourceLabel: string;
      /** WMS layer suffix, e.g. `skyggerelieff`. */
      style: string;
      model: LidarModel;
      year: number | null;
      pointDensity: string | null;
    }
  | {
      kind: 'terrain';
      vis: Visualization;
      model: DemModel;
      /** Degrees, degrees, dimensionless. */
      azimuth: number;
      altitude: number;
      zFactor: number;
      /** Metres; ignored by views with no radius. */
      radius: number;
    }
  | {
      kind: 'flyfoto';
      /** `NIB_MOSAIC`, or one acquisition's prosjektnavn. */
      projectId: string;
      projectName: string | null;
      year: number | null;
      photoDate: string | null;
    }
  | {
      /** Shaded relief with the sun walked all the way round, as a WebM loop.
       *  Sidecar only. No azimuth: the loop is every azimuth. */
      kind: 'sunloop';
      model: DemModel;
      altitude: number;
      zFactor: number;
      stepDeg: number;
      fps: number;
    }
  | {
      /** One of RVT's blended visualizations, sidecar only. One kind for all of
       *  them; which blend is `vis`. */
      kind: 'rvt';
      vis: RvtBlend;
      model: DemModel;
    };

// Fixed, not a form: height and exaggeration are the analysis panel's defaults,
// so a loop and a still of the same ground are lit alike. DTM, because a canopy
// walked round is a picture of the canopy.
export const SUN_LOOP_SPEC: Extract<EvidenceSpec, { kind: 'sunloop' }> = {
  kind: 'sunloop',
  model: 'dtm',
  altitude: DEFAULT_ALTITUDE,
  zFactor: DEFAULT_Z_FACTOR,
  stepDeg: SUNLOOP_STEP_DEG,
  fps: SUNLOOP_FPS,
};

// Fixed, like the sun loop: a blend is RVT's whole recipe, nothing to ask about.
// DTM, because a blend of the canopy is a picture of the canopy.
export const RVT_SPECS: readonly Extract<EvidenceSpec, { kind: 'rvt' }>[] =
  RVT_BLENDS.map((vis) => ({ kind: 'rvt', vis, model: 'dtm' }));

/** Rendered by the sidecar rather than in the tab that asked. The same split
 *  `BrowserSpec` (`render.ts`) states as a type, off a stored row's kind. */
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

// The spec flattened for the column. The render merges what it achieved over
// this, so nothing here is a figure the pixels must live up to.
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
        altitude: spec.altitude,
        zFactor: spec.zFactor,
        stepDeg: spec.stepDeg,
        fps: spec.fps,
      };
    case 'rvt':
      return { vis: spec.vis, model: spec.model };
  }
};

// A stored row read back as parameters; null when the column no longer describes
// a render — nothing to retry, not a failure.
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
        altitude: num(meta.altitude) ?? 0,
        zFactor: num(meta.zFactor) ?? 1,
        stepDeg: num(meta.stepDeg) ?? SUNLOOP_STEP_DEG,
        fps: num(meta.fps) ?? SUNLOOP_FPS,
      };
    }
    case 'rvt': {
      const vis = asBlend(meta.vis);
      const model = asModel(meta.model);
      // A blend this build no longer knows how to name or ask for again.
      if (!vis || !model) return null;
      return { kind: 'rvt', vis, model };
    }
  }
};

// EPSG:25833, as the render wrote it — not the spot's footprint, which may have
// moved. Null for a row with no rectangle, which cannot be laid back on the map.
export const evidenceBbox = (
  rec: EvidenceRecord,
): [number, number, number, number] | null => bboxOfMeta(rec.meta);

// The same rectangle off a `meta` with no row behind it yet.
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

// Where the burnt-in band starts, as a fraction of height; 1 for anything
// without one (everything but a sun loop). Only the part above it is registered
// to `bbox25833`.
export const evidenceBandTop = (rec: EvidenceRecord): number => {
  const value = num(rec.meta?.bandTop);
  return value != null && value > 0 && value <= 1 ? value : 1;
};

export const evidenceResolution = (rec: EvidenceRecord): number | null =>
  num(rec.meta?.metresPerPx);

// Needs both pixels and a ground to lay them over.
export const isReadable = (rec: EvidenceRecord): boolean =>
  rec.file !== '' && evidenceBbox(rec) !== null;

// Off the kind, not the filename: the kind is known before the file lands.
export const isVideoEvidence = (rec: EvidenceRecord): boolean =>
  rec.kind === 'sunloop';

export const coverOf = (
  rows: readonly EvidenceRecord[],
): EvidenceRecord | null => rows.find(isReadable) ?? null;

// Azimuth degrees per frame. The row's own figure where it kept one: an older
// loop may have been walked in coarser steps.
export const loopStepDeg = (rec: EvidenceRecord): number => {
  const spec = specOf(rec);
  return spec?.kind === 'sunloop' ? spec.stepDeg : SUNLOOP_STEP_DEG;
};

// Metres; absorbs a JSON round trip, and a sub-metre nudge is the same ground.
const BBOX_TOLERANCE_M = 1;

// Float drift only, not a "close enough" threshold: two hillshades one degree
// apart are deliberately two pictures.
const PARAM_TOLERANCE = 1e-6;

const sameBbox = (a: [number, number, number, number], b: unknown): boolean =>
  Array.isArray(b) &&
  b.length === 4 &&
  a.every((v, i) => {
    const other = num(b[i]);
    return other != null && Math.abs(v - other) <= BBOX_TOLERANCE_M;
  });

const sameNumber = (a: number, b: number) => Math.abs(a - b) <= PARAM_TOLERANCE;

// Whether this row is already the picture `spec` would produce over `bbox25833`.
// Only identifying fields count (year and point density are provenance, not
// identity); strict about the rectangle, so a row kept before the footprint moved
// does not read as kept.
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
        sameNumber(stored.altitude, spec.altitude) &&
        sameNumber(stored.zFactor, spec.zFactor) &&
        stored.stepDeg === spec.stepDeg &&
        stored.fps === spec.fps
      );
    case 'rvt':
      return (
        stored.kind === 'rvt' &&
        stored.vis === spec.vis &&
        stored.model === spec.model
      );
  }
};
