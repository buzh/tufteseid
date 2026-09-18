// The pin queue: a kept View is a row of parameters, and this is what turns
// that row into the figure PNG and PATCHes it onto the record afterwards.
//
// Module-level and React-free so it outlives the surface that started it —
// closing the lokalitet must not abandon pixels the author decided to keep,
// and each pin is one atomic update. React reads it through `usePinState`.
//
// One job at a time: every producer is a burst of tile requests against a
// shared public edge or an 800 ms horizon scan on the main thread, so two at
// once finish no sooner and invite shed responses.
//
// A pin is not a cache. Upstreams re-fly and reprocess, so a spec re-rendered
// in three years may not be the image its author read; the pin is the citable
// artifact and `meta.renderedAt` says when it was made.
//
// `failed` is a fault and worth retrying; `empty` means the source has nothing
// over this rectangle and retrying is pointless.

import { t } from 'i18next';
import { transformExtent } from 'ol/proj';
import {
  type AttachmentKind,
  type AttachmentMeta,
  type AttachmentRecord,
  listAttachmentsByIds,
  pinAttachment,
} from '../api/attachments';
import type { LocalityBbox } from '../api/localities';
import { fitImageBlob } from '../figure/figure';
import type { SceneFigureLayer, SceneLayerCredit } from '../figure/specs';
import { metresPerScenePx } from '../funn/frame';
import { renderScene } from '../funn/render';
import { enumerateLidarSources } from '../lidarExtract/sources';
import { withDeadline } from '../shared/utils/deadline';
import { renderTerrain } from '../terrain/render';
import { fetchFlyfoto } from './flyfoto';
import { fetchFlyfotoProjectsForBbox } from './flyfotoProjects';
import {
  groundRasterOf,
  renderViewRaster,
  type ViewRaster,
} from './groundView';
import { extractLidarRaster } from './starterPack';
import { type GroundSpec, viewSpecOf, type ViewSpec } from './viewSpec';

/**
 * Where a record stands with the queue. Absent means "not the queue's
 * business" — either the pixels are already there or nobody has asked.
 */
export type PinState = 'queued' | 'running' | 'empty' | 'failed';

export type PinJob = {
  rec: AttachmentRecord;
  /** The lokalitet's rectangle — the fallback, see `rectangleOf`. */
  bbox4326: LocalityBbox;
  /**
   * The pinned record, handed back to whoever is showing it. Needed because
   * realtime is held back for the length of an edit session, which is when
   * pins happen.
   */
  onPinned?: (rec: AttachmentRecord) => void;
};

// Ceilings on a stall, not budgets. The queue is serial, so a render that
// never settles parks `drain` with every job behind it; expiry is treated as
// an ordinary `failed`, with a retry button. The upload gets the same, which
// is 50 MB — the field's cap — at about 1.5 Mbit/s up.
const RENDER_DEADLINE_MS = 300_000;
const UPLOAD_DEADLINE_MS = 300_000;

// The longest side of a scene's flatten. 6000 px is the largest a single
// member can be (1500 m, the bbox ceiling, at LiDAR's 0.25 m/px), so a flatten
// never coarsens its sharpest layer, and 36 Mpx stays inside `fitImageBlob`'s
// 40 Mpx store fit so nothing is resampled twice.
const SCENE_MAX_SIDE_PX = 6000;

// Filenames end up in a download dialog and in a takeout bundle, so keep them
// to something a filesystem and a URL both accept.
const sanitizeFilename = (s: string) =>
  s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || 'bilde';

// PocketBase's ClientResponseError logs only "400: Failed to update record.";
// the field that actually failed is in `response.data`.
const failureDetail = (e: unknown): string => {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (!data || typeof data !== 'object') return '';
  const keys = Object.keys(data as object);
  return keys.length ? JSON.stringify(data) : '';
};

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
 * The workspace's retry sweep filters on it; without it a failed pin would be
 * re-enqueued by every realtime event.
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

// Render the spec's rectangle, never the lokalitet's current one: a pin can be
// a session behind the spec, and "Juster området" would otherwise produce
// ground the author never kept under a caption naming the extent they did.
// Producers work in lon/lat; specs store EPSG:25833. The lokalitet's bbox is
// the fallback, for records whose meta has no extent.
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

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

// Exhaustive over `AttachmentKind` on purpose: a kind added later is a build
// error here rather than a figure that quietly credits nobody.
const SCENE_CREDIT_BY_KIND: Record<AttachmentKind, SceneLayerCredit> = {
  extract: 'hoydedata',
  flyfoto: 'nib',
  screenshot: 'kartverket',
  // Provenance unknown to the app — the one thing `src/figure/` never invents.
  upload: 'none',
  // The author's own hand, and a flatten of things already credited.
  sketch: 'none',
  scene: 'none',
};

// Duplicates what `metaLineOf` says on a card, deliberately: importing a UI
// module here would pull the kit into a module that runs with no surface.
const groundLabelOf = (spec: GroundSpec): string => {
  switch (spec.kind) {
    case 'lidar':
      return [
        spec.source === 'national'
          ? t('ribbon.lidar.nationalMosaic')
          : spec.source.projectName,
        spec.style,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'terrain':
      return [t(`localities.terrain.vis.${spec.vis}`), spec.model.toUpperCase()]
        .filter(Boolean)
        .join(' · ');
    case 'flyfoto':
      return spec.source === 'mosaic'
        ? t('figure.source.nibMosaic')
        : [t('figure.title.flyfoto'), spec.source.projectId]
            .filter(Boolean)
            .join(' · ');
  }
};

/**
 * Spec → figure. The one place a View becomes pixels. `null` means the source
 * has nothing here, which is not a failure; a throw is, including the deadline
 * — applied here rather than in `runJob` so the picker gets it too.
 *
 * Exported for the picker, whose candidates have no record to pin onto; it
 * keeps these bytes rather than asking for a second render of the same
 * parameters.
 */
export const renderSpec = (
  spec: ViewSpec,
  bbox4326: LocalityBbox,
): Promise<Produced | null> =>
  withDeadline(RENDER_DEADLINE_MS, `${spec.kind} render`, (signal) =>
    renderSpecWithin(spec, bbox4326, signal),
  );

const renderSpecWithin = async (
  spec: ViewSpec,
  bbox4326: LocalityBbox,
  signal: AbortSignal,
): Promise<Produced | null> => {
  switch (spec.kind) {
    case 'lidar': {
      // The catalogue rather than the stored key alone: the key is a name, and
      // what the stitch needs is the URL, prefix and published style list.
      const wanted =
        spec.source === 'national'
          ? 'national'
          : `project:${spec.source.projectName}`;
      const sources = await enumerateLidarSources(bbox4326, spec.model);
      const source = sources.find((s) => s.key === wanted);
      // Retired upstream, or no longer covering this rectangle: `empty`.
      if (!source) return null;
      const raster = await extractLidarRaster(
        source,
        to25833(bbox4326),
        spec.style,
        { signal },
      );
      if (!raster) return null;
      return {
        blob: raster.blob,
        filename: `${sanitizeFilename(raster.sourceLabel)}_${raster.style}.png`,
        meta: {
          metresPerPx: raster.metresPerPx,
          bbox25833: raster.bbox25833,
          // The catalogue is resolved here and gone by stamp time; the legend
          // prints both, and a row kept before either was recorded gets them
          // filled in by its first pin.
          year: source.year,
          pointDensity: source.pointDensity,
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
        signal,
      });
      if (!render) return null;
      const fitted = await fitImageBlob(
        render.canvas,
        render.dem.metresPerPx,
      );
      if (!fitted) return null;
      return {
        blob: fitted.blob,
        filename: `terreng_${spec.vis}_${spec.model}.png`,
        meta: {
          // The file's, not the DEM's: the store fit may have coarsened it.
          metresPerPx: fitted.metresPerPx,
          bbox25833: render.dem.bbox25833,
          // What the finest acquisition over the rectangle publishes. The
          // legend says "resampled from 0,25 m" off the gap between the two,
          // which is the difference between a reading of the ground and a
          // reading of an average of it.
          nativeMetresPerPx: render.dem.nativeMetresPerPx,
          // Write the clamped radius back, or the duplicate guard never
          // matches and offers to fetch this again forever.
          ...(render.radius != null ? { radius: render.radius } : {}),
        },
      };
    }

    case 'sketch': {
      // Asks nothing of the network, so the rectangle and the signal go
      // unused: the strokes are in the spec and the scene is its own extent.
      // Scale 1 is the resolution the author drew at. On white paper, unlike
      // the transparent map overlay — a transparent PNG in a report is a
      // picture of nothing.
      const render = await renderScene(spec.scene.frame, spec.scene.elements, {
        scale: 1,
        background: '#ffffff',
      });
      if (!render) return null;
      const fitted = await fitImageBlob(render.canvas, render.metresPerPx);
      if (!fitted) return null;
      return {
        blob: fitted.blob,
        filename: 'skisse.png',
        meta: {
          metresPerPx: fitted.metresPerPx,
          bbox25833: render.bbox25833,
        },
      };
    }

    case 'flyfoto': {
      const source = spec.source;
      const project =
        source === 'mosaic'
          ? undefined
          : (await fetchFlyfotoProjectsForBbox(bbox4326, signal)).find(
              (p) => p.id === source.projectId,
            );
      if (source !== 'mosaic' && !project) return null;
      const result = await fetchFlyfoto(bbox4326, { project, signal });
      if (!result) return null;
      // JPEG all the way through, like the stitch itself: a lossless copy of a
      // lossy-sourced photograph is several times the bytes for nothing.
      const fitted = await fitImageBlob(
        result.canvas,
        result.metresPerPx,
        'image/jpeg',
        0.9,
      );
      if (!fitted) return null;
      return {
        blob: fitted.blob,
        filename: 'flyfoto.jpg',
        meta: {
          metresPerPx: fitted.metresPerPx,
          bbox25833: result.bbox25833,
        },
      };
    }

    case 'scene': {
      // The flatten: the arrangement, drawn once, bottom to top. Sequential:
      // each member is up to 36 Mpx, so four at once is half a gigabyte of
      // canvases.
      const extent25833 = to25833(bbox4326);
      const [minX, minY, maxX, maxY] = extent25833;
      const widthM = maxX - minX;
      const heightM = maxY - minY;
      if (!(widthM > 0) || !(heightM > 0)) return null;

      // One query for the membership, re-ordered by the scene: the server's
      // order is not the scene's, and the order is the content.
      const byId = new Map(
        (await listAttachmentsByIds(spec.layers.map((l) => l.id))).map(
          (rec) => [rec.id, rec] as const,
        ),
      );
      const ordered = spec.layers.flatMap((layer) => {
        const rec = byId.get(layer.id);
        // Deleted since, or no longer readable: a scene with one fewer layer,
        // and the caption below lists what actually landed.
        return rec ? [{ layer, rec }] : [];
      });

      const ground = spec.ground
        ? await renderViewRaster(spec.ground, extent25833, signal)
        : null;
      if (!ground && ordered.length === 0) return null;

      // The sharpest thing in the stack sets the resolution, with the sheet's
      // ceiling as the floor. An unpinned member has no `metresPerPx` and
      // simply does not vote.
      const floor = Math.max(widthM, heightM) / SCENE_MAX_SIDE_PX;
      const declared = [
        ...(ground
          ? [
              (ground.extent25833[2] - ground.extent25833[0]) /
                ground.canvas.width,
            ]
          : []),
        ...ordered.flatMap(({ rec }) => {
          const m = num(rec.meta?.metresPerPx);
          return m != null && m > 0 ? [m] : [];
        }),
      ];
      const metresPerPx = Math.max(
        floor,
        declared.length ? Math.min(...declared) : floor,
      );

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(widthM / metresPerPx));
      canvas.height = Math.max(1, Math.round(heightM / metresPerPx));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      // White paper only where there is no ground under the layers — a scene
      // built over Kart or Hybrid has no ground spec at all, and a
      // transparent PNG in a report is a picture of nothing. With a ground the
      // sheet stays transparent where the ground is: a terrain render is
      // transparent over its no-data, and white there would paint a patch over
      // the map when the flatten is laid as a lokalitet's arrival cover.
      if (!ground) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Off the rounded canvas rather than off `metresPerPx`, so half a pixel
      // of rounding cannot walk the stack apart across its own rectangle.
      const scaleX = canvas.width / widthM;
      const scaleY = canvas.height / heightM;

      // A member's rectangle is its own, not the scene's — a placed upload or
      // a sketch may sit inside it or hang over its edge — so each raster is
      // drawn where the ground says it is and clipped by the sheet.
      const place = (raster: ViewRaster, alpha: number) => {
        const [rMinX, rMinY, rMaxX, rMaxY] = raster.extent25833;
        const w = (rMaxX - rMinX) * scaleX;
        const h = (rMaxY - rMinY) * scaleY;
        if (!(w > 0) || !(h > 0)) return;
        ctx.save();
        ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
        // Smooth on the way down, nearest on the way up — the same rule
        // `map/groundOverlay.ts` applies, so the flatten matches the screen.
        ctx.imageSmoothingEnabled = w < raster.canvas.width;
        ctx.drawImage(
          raster.canvas,
          (rMinX - minX) * scaleX,
          (maxY - rMaxY) * scaleY,
          w,
          h,
        );
        ctx.restore();
      };

      // The stack as it lands, which is what goes on the record: a member
      // deleted between the ask and the render is in `meta.layers` and not in
      // the pixels, and the legend must describe the pixels.
      const stackGround: SceneFigureLayer | undefined =
        ground && spec.ground
          ? {
              label: groundLabelOf(spec.ground),
              credit: spec.ground.kind === 'flyfoto' ? 'nib' : 'hoydedata',
            }
          : undefined;
      if (ground) place(ground, 1);

      const stackLayers: SceneFigureLayer[] = [];
      for (const { layer, rec } of ordered) {
        const memberSpec = viewSpecOf(rec);
        let raster: ViewRaster | null;
        if (memberSpec?.kind === 'sketch') {
          // A sketch cannot come from its own pin — that figure is on white
          // paper and would erase the stack — so re-render it transparent, at
          // the sheet's resolution so the strokes stay a hand's width.
          const render = await renderScene(
            memberSpec.scene.frame,
            memberSpec.scene.elements,
            { scale: metresPerScenePx(memberSpec.scene.frame) / metresPerPx },
          );
          raster = render
            ? { canvas: render.canvas, extent25833: render.bbox25833 }
            : null;
        } else {
          raster = await groundRasterOf(rec, signal);
        }
        // A layer that did not land must leave the stack too: naming a layer
        // the pixels do not contain is what `src/figure/` exists to prevent.
        if (!raster) continue;
        place(raster, layer.opacity / 100);
        stackLayers.push({
          label: rec.caption.trim() || t(`localities.bilder.kind.${rec.kind}`),
          opacity: layer.opacity,
          credit: SCENE_CREDIT_BY_KIND[rec.kind],
        });
      }

      // Everything the scene named is gone or empty: nothing to retry against.
      if (!stackGround && stackLayers.length === 0) return null;

      const fitted = await fitImageBlob(canvas, metresPerPx);
      if (!fitted) return null;
      return {
        blob: fitted.blob,
        filename: 'oppsett.png',
        meta: {
          metresPerPx: fitted.metresPerPx,
          bbox25833: extent25833,
          // Labels verbatim, because they are the members' own captions;
          // credits as enum keys, so the rights lines they turn into are still
          // written in the reader's language at stamp time.
          stack: {
            ...(stackGround ? { ground: stackGround } : {}),
            layers: stackLayers,
          },
        },
      };
    }
  }
};

/** One job, start to finish. Resolves to the pinned record, or null. */
const runJob = async (job: PinJob): Promise<AttachmentRecord | null> => {
  const spec = viewSpecOf(job.rec);
  // A File, or a View whose meta no longer parses: `failed` would put a retry
  // button on a card with nothing to retry.
  if (!spec) {
    states.set(job.rec.id, 'empty');
    return null;
  }
  const bbox4326 = rectangleOf(job.rec, job.bbox4326);
  const produced = await renderSpec(spec, bbox4326);
  if (!produced) {
    states.set(job.rec.id, 'empty');
    return null;
  }
  // No signal: a multipart PATCH already on the wire cannot be taken back, so
  // the deadline only guarantees rejection — the queue moves on while the
  // browser finishes or drops the transfer in its own time.
  const pinned = await withDeadline(UPLOAD_DEADLINE_MS, 'pin upload', () =>
    pinAttachment(job.rec.id, produced.blob, produced.filename, {
      ...(job.rec.meta ?? {}),
      ...produced.meta,
      renderedAt: new Date().toISOString(),
    }),
  );
  states.delete(job.rec.id);
  job.onPinned?.(pinned);
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
        console.warn('[pinQueue] pin failed', job.rec.id, failureDetail(e), e);
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
 * Idempotent while a job is in flight. The guard is on the live states rather
 * than `attempted` so a `failed` or `empty` record can still be retried.
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
 * The pixels, now, awaited — for the callers that need the bytes themselves
 * (`Last ned`, the Rapportpakke). Jumps the queue rather than joining it, and
 * does the work again if a job is already running for this record.
 */
export const pinNow = async (job: PinJob): Promise<AttachmentRecord | null> => {
  attempted.add(job.rec.id);
  states.set(job.rec.id, 'running');
  publish();
  try {
    return await runJob(job);
  } catch (e) {
    console.warn(
      '[pinQueue] forced pin failed',
      job.rec.id,
      failureDetail(e),
      e,
    );
    states.set(job.rec.id, 'failed');
    return null;
  } finally {
    publish();
  }
};
