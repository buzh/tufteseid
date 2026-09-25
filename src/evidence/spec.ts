import type { EvidenceMeta, EvidenceRecord } from '../api/evidence';
import type { LidarModel } from '../map/layers/config/backgroundLayers/lidarProjects';
import type { DemModel } from '../terrain/dem';
import { VISUALIZATIONS, type Visualization } from '../terrain/shade';

/** The seamless best-available mosaic, as against one acquisition. */
export const NIB_MOSAIC = 'mosaic';

/** Degrees between frames. Must divide 360, or the loop jumps where it closes;
 *  the sidecar refuses one that does not. */
export const SUNLOOP_STEP_DEG = 5;
export const SUNLOOP_FPS = 24;

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
      /** Metres. Carried for every view; the ones with no radius ignore it. */
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
       *  Rendered by the sidecar, never in the browser. No azimuth: the loop is
       *  every azimuth. */
      kind: 'sunloop';
      model: DemModel;
      altitude: number;
      zFactor: number;
      stepDeg: number;
      fps: number;
    };

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

/** The spec, flattened for the column. The render merges what it achieved over
 *  this; nothing here is a number the pixels have to live up to. */
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
  }
};

/** A stored row read back as parameters. Null when the column no longer
 *  describes a render — which is a row with nothing to retry, not a failure. */
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
  }
};

/**
 * The ground the pixels cover, EPSG:25833, as the render wrote it — not the
 * spot's footprint, which may have moved since. Null for a row that has no
 * rectangle, and so cannot be laid back on the map.
 */
export const evidenceBbox = (
  rec: EvidenceRecord,
): [number, number, number, number] | null => {
  const raw = rec.meta?.bbox25833;
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const out = raw.map(num);
  return out.every((v) => v != null)
    ? (out as [number, number, number, number])
    : null;
};

/**
 * Where the burnt-in provenance band starts, as a fraction of the picture's
 * height; 1 for anything without one, which is everything but a sun loop. A
 * still is stamped in the reader's own tab at download time and the kept
 * pixels are clean, but `createImageBitmap` throws on a WebM, so a loop is
 * cited on the way out of the sidecar instead (`docs/render-sidecar.md`). Only
 * the part above the band is registered to `bbox25833`.
 */
export const evidenceBandTop = (rec: EvidenceRecord): number => {
  const value = num(rec.meta?.bandTop);
  return value != null && value > 0 && value <= 1 ? value : 1;
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

/**
 * Whether this row is already the picture `spec` would produce over
 * `bbox25833`. Only the identifying fields count — an acquisition's year and
 * point density are stored for provenance, not identity. Strict about the
 * rectangle: a row kept before the footprint moved covers different ground and
 * must not read as kept.
 */
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
  }
};
