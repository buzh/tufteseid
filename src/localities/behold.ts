/*
 * `Behold` — keep the ground you are looking at (docs/lokalitet-view.md §4.3).
 *
 * One verb on the lokalitet row, and it is the general answer to "how do I add
 * an image": dial the ground up on the map the way you want it, then press it.
 * What comes out is the rectangle *in that ground*, at the source's native
 * resolution — not a screenshot of it.
 *
 * | Ground on screen | What it writes                                        |
 * |------------------|-------------------------------------------------------|
 * | 2 LiDAR          | a spec: the active dataset, style and model           |
 * | 5 Terreng        | a spec: the current visualization and knobs           |
 * | 4 Flyfoto        | a spec: the active acquisition                        |
 * | 1 Standard, 3 Hybrid | nothing — disabled, the tooltip says Skjermbilde   |
 *
 * The last row is a refusal, not an omission. There is no rectangle-fetch path
 * for the topo WMS, and Hybrid's overlay is a *separate layer* the extract path
 * cannot see — so a `Behold` there would hand back a plain LiDAR hillshade
 * labelled as the hybrid view the user was reading. `Skjermbilde` is the honest
 * verb for those two and it already exists.
 *
 * ## Why this is an atom
 *
 * The button is on the lokalitet row and the answer is in row 1. The four
 * control hooks that know which ground is up, at which dataset and which
 * knobs, are mounted once in `RibbonGlobalRow`, which is a *sibling* of the
 * lokalitet row rather than its parent — the same split `coverTerrainSpecAtom`
 * crosses in the other direction. So row 1 publishes what its ground can
 * offer, and `useLocalityWorkspace` decides what to do with it.
 *
 * Only the terrain arm carries a describer, and since §4.1.2 that is all it
 * carries: a spec, not a figure. Terrain is the one ground whose parameters
 * are not recoverable from the map — eight visualizations, three sliders and
 * a model, all of them state inside `useTerrainAnalysis` — so the hook has to
 * say what it is currently showing. The other two arms name a dataset, and a
 * dataset name is the whole spec.
 *
 * Nothing here produces pixels any more. Keeping a View writes the row and
 * returns; `localities/pinQueue.ts` makes the image afterwards.
 */

import { atom } from 'jotai';
import type {
  AttachmentKind,
  AttachmentMeta,
  AttachmentRecord,
} from '../api/attachments';
import type { LidarSource } from '../lidarExtract/sources';
import type { FlyfotoProject } from './flyfotoProjects';

/**
 * A row of parameters, and the record that will carry it (§4.1.2).
 *
 * `meta` here is the *identifying* half only — what was asked for. What making
 * the image reveals — `imageRect`, the resolution the source actually gave,
 * `renderedAt` — is written by the pin, not by this.
 */
export type BeholdSpec = {
  kind: AttachmentKind;
  caption: string;
  meta: AttachmentMeta;
};

export type BeholdOffer =
  // Standard and Hybrid. Named rather than collapsed to `null` so the button
  // can say *why* it is disabled — an absent offer and a refused one are
  // different sentences, and the tooltip is the whole point of this row.
  | { ground: 'standard' | 'hybrid' }
  | {
      ground: 'lidar';
      // Null while the national mosaic's style list is still in flight.
      source: LidarSource | null;
      // Already clamped through `effectiveLidarStyle`, so this is the layer
      // that will actually be requested rather than the DTM pick DOM is
      // holding for later.
      style: string;
    }
  | {
      ground: 'terreng';
      // Null until a DEM has been fetched and painted.
      key: BeholdKey | null;
      // Synchronous, because reading your own state is not work. That it costs
      // nothing is the point: `Behold` on Terreng is now a POST of ~300 bytes.
      //
      // No `subject` argument, unlike the producer this replaced: the subject
      // was for the figure's title line, and the figure is now the pin
      // queue's business.
      describe: () => BeholdSpec | null;
    }
  | { ground: 'flyfoto'; project: FlyfotoProject | null };

export const beholdOfferAtom = atom<BeholdOffer | null>(null);

/*
 * The duplicate guard's natural key (§4.3).
 *
 * Same source, style, model and parameters over the same rectangle is the same
 * image, so the `meta` block is the key and `Behold` reads `Beholdt` while it
 * matches something already kept. Without it a session of scrubbing the
 * azimuth slider leaves forty near-identical renders, and `hidden` (§4.4) is
 * then curation against a mess this made.
 *
 * `kind` is here because the three producers do not write the same fields: a
 * LiDAR extract names its WMS dataset in `sourceKey`, a terrain render has no
 * dataset to name and is identified by its knobs instead, and a flyfoto grab
 * says which NiB acquisition it is in `nibSource` / `projectId`.
 */
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

// Metres. The three producers all derive their extent from the same
// `transformExtent(locality.bbox)`, so this only has to absorb a JSON round
// trip — but a rectangle nudged by less than a metre by "Juster området" is
// the same picture anyway, which is the behaviour worth having if it ever
// does more than that.
const BBOX_TOLERANCE_M = 1;

// Sliders emit exact values, so this only guards against float drift through
// JSON. Not a "close enough" threshold: two hillshades one degree apart are
// deliberately two images.
const PARAM_TOLERANCE = 1e-6;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;

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
 *
 * Deliberately strict about the rectangle: an image kept before "Juster
 * området" moved the bbox describes different ground, and offering `Beholdt`
 * for it would refuse to fetch the one the user can now see.
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
        // What tells a terrain render from a LiDAR extract: they share a
        // `kind` because they share a schema, and only the second one has a
        // WMS dataset to name (see `viewSpecOf`).
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
