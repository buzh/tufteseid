// `Behold` keeps the ground on screen as a spec. An atom because the button is
// on the lokalitet row while the ground hooks are mounted once in
// `RibbonGlobalRow`, a sibling rather than a parent. Nothing here makes pixels:
// `pinQueue.ts` renders the spec afterwards.

import { atom } from 'jotai';
import type {
  AttachmentKind,
  AttachmentMeta,
  AttachmentRecord,
} from '../api/attachments';
import type { LidarSource } from '../lidarExtract/sources';
import type { FlyfotoProject } from './flyfotoProjects';

/**
 * A row of parameters and the record that will carry it. `meta` is the
 * identifying half only; the achieved resolution and `renderedAt` are written
 * by the pin.
 */
export type BeholdSpec = {
  kind: AttachmentKind;
  caption: string;
  meta: AttachmentMeta;
};

export type BeholdOffer =
  // Named rather than collapsed to `null` so the button can say why it is
  // disabled: an absent offer and a refused one are different tooltips.
  | { ground: 'standard' | 'hybrid' }
  | {
      ground: 'lidar';
      // Null while the national mosaic's style list is still in flight.
      source: LidarSource | null;
      // Already clamped through `effectiveLidarStyle`, so this is the layer
      // that will actually be requested.
      style: string;
    }
  | {
      ground: 'terreng';
      // Null until a DEM has been fetched and painted.
      key: BeholdKey | null;
      describe: () => BeholdSpec | null;
    }
  | { ground: 'flyfoto'; project: FlyfotoProject | null };

export const beholdOfferAtom = atom<BeholdOffer | null>(null);

// The duplicate guard's natural key: same source, style, model and parameters
// over the same rectangle is the same image, and `Behold` reads `Beholdt`
// while it matches something already kept.
export type BeholdKey = {
  kind: 'lidar' | 'terrain' | 'flyfoto';
  /** `project:X` | `national` for LiDAR, the acquisition id for NiB. */
  sourceKey: string;
  /** WMS style suffix, or the terrain visualization. Empty for flyfoto. */
  style: string;
  /** `dtm` | `dom`, or empty where the distinction does not apply. */
  model: string;
  /** Terrain's sun and radius — the numbers `viewSpecOf` reads back. */
  params?: Record<string, number>;
};

/** The seamless best-available mosaic, as against one acquisition. */
export const NIB_MOSAIC_KEY = 'mosaic';

// The two grounds whose spec is a dataset name. Shared by `Behold` and
// `sceneSpec.ts`: `viewSpecOf` and `attachmentMatchesKey` read both back, so
// there must be exactly one key list. Terrain describes itself instead.
export const lidarSpecMeta = (
  source: LidarSource,
  style: string,
  bbox25833: [number, number, number, number],
): AttachmentMeta => ({
  sourceKey: source.key,
  sourceLabel: source.label,
  style,
  model: source.model,
  // Neither is read back to re-request anything; both are here because the
  // legend is stamped from the record long after the catalogue that knew them
  // has gone, and "opptaksår 2016" is the difference between two readings of
  // the same field. Null on the national mosaic, which publishes neither.
  year: source.year,
  pointDensity: source.pointDensity,
  bbox25833,
});

export const flyfotoSpecMeta = (
  project: FlyfotoProject | undefined,
  bbox25833: [number, number, number, number],
): AttachmentMeta => ({
  sourceLabel: 'Norge i bilder',
  bbox25833,
  ...(project
    ? {
        nibSource: 'project',
        // The ImageServer's own selector (prosjektnavn); same string as
        // projectName today, kept separate because the display name is free
        // to stop being the selector.
        projectId: project.id,
        projectName: project.projectName,
        // The acquisition's native resolution, which `fetchFlyfoto` needs to
        // plan the tile grid before the stitch exists.
        projectMetresPerPx: project.metresPerPx,
        year: project.year,
        photoDate: project.photoDate,
      }
    : { nibSource: 'mosaic' }),
});

// Metres; absorbs a JSON round trip, and a sub-metre nudge is the same picture.
const BBOX_TOLERANCE_M = 1;

// Float drift only, not a "close enough" threshold: two hillshades one degree
// apart are deliberately two images.
const PARAM_TOLERANCE = 1e-6;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;

const sameBbox = (a: [number, number, number, number], b: unknown): boolean =>
  Array.isArray(b) &&
  b.length === 4 &&
  a.every((v, i) => {
    const other = num(b[i]);
    return other != null && Math.abs(v - other) <= BBOX_TOLERANCE_M;
  });

const sameParams = (
  meta: AttachmentMeta,
  params: Record<string, number> | undefined,
): boolean => {
  if (!params) return true;
  for (const [key, value] of Object.entries(params)) {
    const stored = num(meta[key]);
    if (stored == null || Math.abs(stored - value) > PARAM_TOLERANCE) {
      return false;
    }
  }
  return true;
};

/**
 * Whether this record is already the image `Behold` is about to produce.
 * Strict about the rectangle: a spec kept before "Juster området" moved the
 * bbox describes different ground and must not read as `Beholdt`.
 */
export const attachmentMatchesKey = (
  rec: AttachmentRecord,
  key: BeholdKey,
  bbox25833: [number, number, number, number],
): boolean => {
  const meta = rec.meta;
  if (!meta || !sameBbox(bbox25833, meta.bbox25833)) return false;

  switch (key.kind) {
    case 'lidar':
      return (
        rec.kind === 'extract' &&
        str(meta.sourceKey) === key.sourceKey &&
        str(meta.style) === key.style &&
        // Records written before the extract path knew DOM carry no model,
        // and every one of them is a DTM stitch.
        (str(meta.model) ?? 'dtm') === key.model
      );
    case 'terrain':
      return (
        rec.kind === 'extract' &&
        // Terrain renders and LiDAR extracts share a `kind`; only the latter
        // names a WMS dataset.
        str(meta.sourceKey) == null &&
        str(meta.style) === key.style &&
        (str(meta.model) ?? 'dtm') === key.model &&
        sameParams(meta, key.params)
      );
    case 'flyfoto':
      return (
        rec.kind === 'flyfoto' &&
        (key.sourceKey === NIB_MOSAIC_KEY
          ? meta.nibSource !== 'project'
          : str(meta.projectId) === key.sourceKey)
      );
  }
};
