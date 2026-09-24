// A kept render is its parameters first and its pixels second. This is the
// round trip: what the queue needs in order to make the image, flattened into
// the record's JSON column and read back field by field afterwards.
//
// Identity and provenance are not the same set. Only the identifying fields
// decide whether two rows are the same picture (`evidenceMatches`); the rest —
// the acquisition's year, its point density, the photo date — ride along
// because the catalogue that knew them is gone by the time anyone reads the
// card, and "opptaksår 2016" is the difference between two readings of the
// same field.

import type { EvidenceMeta, EvidenceRecord } from '../api/evidence';
import type { LidarModel } from '../map/layers/config/backgroundLayers/lidarProjects';
import type { DemModel } from '../terrain/dem';
import type { Visualization } from '../terrain/shade';

/** The seamless best-available mosaic, as against one acquisition. */
export const NIB_MOSAIC = 'mosaic';

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
      /** The acquisition's native resolution, which the grab needs to plan its
       *  tile grid before the stitch exists. */
      projectMetresPerPx: number | null;
    };

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;

const VISUALIZATIONS: readonly string[] = [
  'hillshade',
  'multiHillshade',
  'vat',
  'svf',
  'openPos',
  'openNeg',
  'lrm',
  'slope',
];

const asVis = (v: unknown): Visualization | null =>
  typeof v === 'string' && VISUALIZATIONS.includes(v)
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
        projectMetresPerPx: spec.projectMetresPerPx,
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
        projectMetresPerPx: num(meta.projectMetresPerPx),
      };
    }
  }
};

// Metres; absorbs a JSON round trip, and a sub-metre nudge is the same ground.
const BBOX_TOLERANCE_M = 1;

// Float drift only, not a "close enough" threshold: two hillshades one degree
// apart are deliberately two pictures.
const PARAM_TOLERANCE = 1e-6;

const sameBbox = (
  a: [number, number, number, number],
  b: unknown,
): boolean =>
  Array.isArray(b) &&
  b.length === 4 &&
  a.every((v, i) => {
    const other = num(b[i]);
    return other != null && Math.abs(v - other) <= BBOX_TOLERANCE_M;
  });

const sameNumber = (a: number, b: number) => Math.abs(a - b) <= PARAM_TOLERANCE;

/**
 * Whether this row is already the picture `spec` would produce over
 * `bbox25833`. Strict about the rectangle: a row kept before the footprint
 * moved covers different ground and must not read as kept.
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
  }
};
