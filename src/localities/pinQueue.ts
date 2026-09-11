/*
 * The pin queue: turning kept specs into pixels, afterwards
 * (docs/lokalitet-view.md §4.1.2).
 *
 * A View — a LiDAR extract, a terrain render, a flyfoto grab — is *a row of
 * parameters*, and every surface that keeps one now writes only that row.
 * `Behold` returns in the time of one small POST instead of the time of a
 * tile burst, the starter set fills a rail in a second, and discarding costs
 * nothing at all. This module is the other half of that bargain: the thing
 * that goes and makes the image the record already fully describes.
 *
 * ## Why the pixels have to exist at all
 *
 * "Just store the parameters" is not the whole answer, and the limit is worth
 * being precise about. Reproducible is not the same as reproducible *forever*.
 * Kartverket re-flies LiDAR projects and retires the old ones, NiB reprocesses
 * its mosaics, hoydedata updates a DTM when new laser lands — so a spec
 * re-rendered in three years may honestly not be the image its author was
 * reading, and the caption would say the same words over different pixels.
 * That is the precise failure `src/figure/` exists to prevent, in a new place.
 * So the pin is not a cache. It is the citable artifact, and `meta.renderedAt`
 * is when it was made.
 *
 * ## Shape
 *
 * Module-level and imperative, like `map/groundOverlay.ts`, and for the same
 * kind of reason: it must outlive the surface that started it. Closing the
 * lokalitet — or pressing `Ferdig` — is not a reason to abandon pixels the
 * author already decided were worth keeping, and there is nothing half-written
 * to lose either way, since each pin is one atomic update. React reads it
 * through `usePinState` in `bilderCommon.tsx`.
 *
 * **One job at a time.** Every producer here is a burst of tile requests
 * against a shared public edge, or an 800 ms horizon scan on the main thread.
 * Two at once would not finish sooner; it would make both slower and invite
 * shed responses. Same argument the starter set and the flyfoto batch each
 * used to make for themselves — it lives in one place now, which is most of
 * why this is a queue rather than a function.
 *
 * The three states a job can end in are deliberately distinct. `failed` is a
 * fault and is worth retrying; `empty` means the source has nothing over this
 * rectangle and retrying is pointless — a 1962 acquisition that turns out not
 * to reach this valley is a fact about the ground, not an error, and the card
 * says so instead of spinning.
 */

import { transformExtent } from 'ol/proj';
import {
  type AttachmentMeta,
  type AttachmentRecord,
  pinAttachment,
} from '../api/attachments';
import type { LocalityBbox } from '../api/localities';
import { renderFigureBlob } from '../figure/figure';
import { flyfotoFigure, terrainFigure } from '../figure/specs';
import { enumerateLidarSources } from '../lidarExtract/sources';
import { renderTerrain } from '../terrain/render';
import { fetchFlyfoto } from './flyfoto';
import { fetchFlyfotoProjectsForBbox } from './flyfotoProjects';
import { extractLidarFigure } from './starterPack';
import { viewSpecOf, type ViewSpec } from './viewSpec';

/**
 * Where a record stands with the queue. Absent means "not the queue's
 * business" — either the pixels are already there or nobody has asked.
 */
export type PinState = 'queued' | 'running' | 'empty' | 'failed';

export type PinJob = {
  rec: AttachmentRecord;
  /** The lokalitet's rectangle — the fallback, see `rectangleOf`. */
  bbox4326: LocalityBbox;
  /** The lokalitet's name, for the figure's title line. */
  subject?: string;
};

// Filenames end up in a download dialog and in a takeout bundle, so keep them
// to something a filesystem and a URL both accept.
const sanitizeFilename = (s: string) =>
  s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || 'bilde';

const queue: PinJob[] = [];
const states = new Map<string, PinState>();
const attempted = new Set<string>();
const listeners = new Set<() => void>();
let draining = false;

const publish = () => {
  for (const fn of listeners) fn();
};

export const subscribePinQueue = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const pinStateOf = (id: string): PinState | undefined => states.get(id);

/**
 * Whether this record has already been offered to the queue in this session.
 *
 * What the workspace's retry sweep filters on. Without it, a record whose pin
 * failed would be re-enqueued by every realtime event — and the list reloads
 * wholesale on every one of those.
 */
export const pinAttempted = (id: string): boolean => attempted.has(id);

/** What a producer hands back: the figure, and what making it revealed. */
export type Produced = {
  blob: Blob;
  filename: string;
  /** Merged over the spec — never replacing it. */
  meta: AttachmentMeta;
};

const to25833 = (bbox: LocalityBbox) =>
  transformExtent(bbox, 'EPSG:4326', 'EPSG:25833') as [
    number,
    number,
    number,
    number,
  ];

/*
 * Which rectangle to render — the *spec's*, not the lokalitet's.
 *
 * Every producer works in lon/lat, and every spec records its extent in
 * EPSG:25833, so this goes back the way the writer came. It matters because a
 * pin can be minutes or a session behind the spec: "Juster området" moves the
 * lokalitet's rectangle, and a queued render that followed it would produce an
 * image of ground the author never asked to keep, under a caption that says
 * the extent they did ask for. The record is the spec; the rectangle is part
 * of it.
 *
 * The lokalitet's own bbox is the fallback, for records written before any of
 * this existed and for the one producer whose meta has no extent to read.
 */
const rectangleOf = (rec: AttachmentRecord, fallback: LocalityBbox) => {
  const stored = rec.meta?.bbox25833;
  if (
    !Array.isArray(stored) ||
    stored.length !== 4 ||
    !stored.every((v) => typeof v === 'number' && Number.isFinite(v))
  ) {
    return fallback;
  }
  return transformExtent(
    stored as number[],
    'EPSG:25833',
    'EPSG:4326',
  ) as LocalityBbox;
};

/**
 * Spec → figure. The one place a View becomes pixels, whichever of the three it
 * is, and the mirror of `useRecreateView`: that one applies a spec to the live
 * map, this one applies it to a canvas nobody is watching.
 *
 * `null` is "the source has nothing here", which is not a failure. Anything
 * that throws is.
 *
 * Exported for the picker (§4.3), which is the one caller that renders a spec
 * with no record behind it: a picker candidate is not an attachment until it is
 * kept, so it has nothing to pin onto and nothing to enqueue. Keeping one then
 * writes *these* bytes rather than asking the queue for a second render of the
 * same parameters — which spares Kartverket a duplicate tile burst and makes
 * the stored pin literally the pixels the author looked at when they decided.
 */
export const renderSpec = async (
  spec: ViewSpec,
  bbox4326: LocalityBbox,
  subject: string | undefined,
): Promise<Produced | null> => {
  switch (spec.kind) {
    case 'lidar': {
      // The catalogue rather than the stored key alone: a project is a name in
      // a 1936-entry GetCapabilities and what we need is its URL, prefix and
      // published style list. Cached, so three specs off the same lokalitet
      // cost one lookup.
      const wanted =
        spec.source === 'national'
          ? 'national'
          : `project:${spec.source.projectName}`;
      const sources = await enumerateLidarSources(bbox4326, spec.model);
      const source = sources.find((s) => s.key === wanted);
      // The project no longer covers this rectangle, or has been retired
      // upstream. Nothing to retry against, which is exactly `empty`.
      if (!source) return null;
      const raster = await extractLidarFigure(
        source,
        to25833(bbox4326),
        spec.style,
        { subject },
      );
      if (!raster) return null;
      return {
        blob: raster.blob,
        filename: `${sanitizeFilename(raster.sourceLabel)}_${raster.style}.png`,
        meta: {
          metresPerPx: raster.metresPerPx,
          bbox25833: raster.bbox25833,
          imageRect: raster.imageRect,
        },
      };
    }

    case 'terrain': {
      const light = {
        azimuth: spec.azimuth,
        altitude: spec.altitude,
        zFactor: spec.zFactor,
      };
      const render = await renderTerrain(bbox4326, {
        vis: spec.vis,
        model: spec.model,
        light,
        radius: spec.radius,
      });
      if (!render) return null;
      const figure = await renderFigureBlob(
        render.canvas,
        terrainFigure({
          subject,
          vis: spec.vis,
          model: spec.model,
          light,
          dem: render.dem,
          // The clamped one — see `TerrainRender.radius`.
          radius: render.radius,
        }),
      );
      if (!figure) return null;
      return {
        blob: figure.blob,
        filename: `terreng_${spec.vis}_${spec.model}.png`,
        meta: {
          metresPerPx: render.dem.metresPerPx,
          bbox25833: render.dem.bbox25833,
          imageRect: figure.imageRect,
          // Written back because the grid may have clamped it. A spec that
          // asked for 20 m and got 6 m should say 6 m from now on, or the
          // duplicate guard would offer to fetch it again forever.
          ...(render.radius != null ? { radius: render.radius } : {}),
        },
      };
    }

    case 'flyfoto': {
      const source = spec.source;
      const project =
        source === 'mosaic'
          ? undefined
          : (await fetchFlyfotoProjectsForBbox(bbox4326)).find(
              (p) => p.id === source.projectId,
            );
      if (source !== 'mosaic' && !project) return null;
      const result = await fetchFlyfoto(bbox4326, { project });
      if (!result) return null;
      // JPEG all the way through, like the stitch itself: the caption is large
      // flat type and survives it, and a lossless copy of a lossy-sourced
      // photograph is several times the bytes for nothing.
      const figure = await renderFigureBlob(
        result.canvas,
        flyfotoFigure({
          subject,
          project,
          metresPerPx: result.metresPerPx,
          bbox25833: result.bbox25833,
        }),
        'image/jpeg',
        0.9,
      );
      if (!figure) return null;
      return {
        blob: figure.blob,
        filename: 'flyfoto.jpg',
        meta: {
          metresPerPx: result.metresPerPx,
          bbox25833: result.bbox25833,
          imageRect: figure.imageRect,
        },
      };
    }
  }
};

/** One job, start to finish. Resolves to the pinned record, or null. */
const runJob = async (job: PinJob): Promise<AttachmentRecord | null> => {
  const spec = viewSpecOf(job.rec);
  // A File, or a View whose meta no longer parses. Neither is the queue's to
  // fix, and leaving it `failed` would put a retry button on a card that has
  // nothing to retry.
  if (!spec) {
    states.set(job.rec.id, 'empty');
    return null;
  }
  const bbox4326 = rectangleOf(job.rec, job.bbox4326);
  const produced = await renderSpec(spec, bbox4326, job.subject);
  if (!produced) {
    states.set(job.rec.id, 'empty');
    return null;
  }
  const pinned = await pinAttachment(
    job.rec.id,
    produced.blob,
    produced.filename,
    {
      ...(job.rec.meta ?? {}),
      ...produced.meta,
      // Provenance, so a pin and its spec can be compared later rather than
      // merely trusted. It lives inside `meta` because provenance already has
      // a home there and this needs no column of its own.
      renderedAt: new Date().toISOString(),
    },
  );
  states.delete(job.rec.id);
  return pinned;
};

const drain = async () => {
  if (draining) return;
  draining = true;
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      states.set(job.rec.id, 'running');
      publish();
      try {
        await runJob(job);
      } catch (e) {
        console.warn('[pinQueue] pin failed', job.rec.id, e);
        states.set(job.rec.id, 'failed');
      }
      publish();
    }
  } finally {
    draining = false;
  }
};

/**
 * Ask for a spec's pixels. Returns immediately; the work happens behind.
 *
 * Idempotent while a job is in flight, so the workspace's retry sweep can run
 * on every list reload without piling up duplicates of the one already
 * running. A `failed` or `empty` record *can* be re-enqueued — that is the
 * retry button — which is why the guard is on the live states and not on
 * `attempted`.
 */
export const enqueuePin = (job: PinJob): void => {
  const state = states.get(job.rec.id);
  if (state === 'queued' || state === 'running') return;
  attempted.add(job.rec.id);
  states.set(job.rec.id, 'queued');
  queue.push(job);
  publish();
  void drain();
};

/**
 * The pixels, now, awaited — for the two callers whose whole purpose is the
 * bytes (§4.1.2): `Last ned` and, later, the Rapportpakke. There is no such
 * thing as downloading a parameter row.
 *
 * It jumps the queue rather than joining it, because it has somebody waiting
 * on it. A job already running for this record is left alone and this simply
 * does the work again — one wasted render is a better answer than a promise
 * that resolves when an unrelated batch ahead of it finishes.
 */
export const pinNow = async (job: PinJob): Promise<AttachmentRecord | null> => {
  attempted.add(job.rec.id);
  states.set(job.rec.id, 'running');
  publish();
  try {
    return await runJob(job);
  } catch (e) {
    console.warn('[pinQueue] forced pin failed', job.rec.id, e);
    states.set(job.rec.id, 'failed');
    return null;
  } finally {
    publish();
  }
};
