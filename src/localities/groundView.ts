// A kept bilde as a layer over its own rectangle: paint the pinned file where
// there is one, render the spec live where there is not. A pinned file is the
// source's own pixels, edge to edge, so it goes on the ground unaltered and
// there is no resolution ladder here; adding one means measuring the producers
// again.

import { transformExtent } from 'ol/proj';
import { useEffect, useState } from 'react';
import { getAttachmentUrl, type AttachmentRecord } from '../api/attachments';
import type { LocalityBbox } from '../api/localities';
import { extractCanvas } from '../lidarExtract/run';
import { enumerateLidarSources } from '../lidarExtract/sources';
import { setGroundOverlay } from '../map/groundOverlay';
import { withDeadline } from '../shared/utils/deadline';
import { demImageExtent, renderTerrain } from '../terrain/render';
import { fetchFlyfoto } from './flyfoto';
import { fetchFlyfotoProjectsForBbox } from './flyfotoProjects';
import { isPinned, viewSpecOf, type ViewSpec } from './viewSpec';

// Same ceiling as the pin queue, deliberately: same producer, same work. What
// keeps it from being felt is the abort on switching records, not a shorter
// clock.
const LIVE_RENDER_DEADLINE_MS = 300_000;

/** `[minX, minY, maxX, maxY]` in EPSG:25833. */
export const groundExtentOf = (meta: Record<string, unknown>) => {
  const b = meta.bbox25833;
  return Array.isArray(b) &&
    b.length === 4 &&
    b.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? (b as [number, number, number, number])
    : null;
};

// Where the ground sits inside the stored PNG, in that file's own pixels.
// Stored files are bare ground now, so this is the whole image; the branch
// survives for records pinned while the caption panel was still burned in
// below it, whose `meta.imageRect` says how much of the file is map.
const cropOf = (meta: Record<string, unknown>, img: HTMLImageElement) => {
  const r = meta.imageRect as Record<string, unknown> | undefined;
  const n = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const x = n(r?.x);
  const y = n(r?.y);
  const width = n(r?.width);
  const height = n(r?.height);
  return x != null && y != null && width != null && height != null
    ? { x, y, width, height }
    : { x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight };
};

/** Ground edge to edge, so no crop to carry. */
export type ViewRaster = {
  canvas: HTMLCanvasElement;
  extent25833: [number, number, number, number];
};

// Spec → ground pixels. Sibling of `pinQueue.renderSpec`, which produces the
// same pixels as a file to store. `null` means the source has nothing over
// this rectangle; a throw is a failure.
export const renderViewRaster = async (
  spec: ViewSpec,
  extent25833: [number, number, number, number],
  signal: AbortSignal,
): Promise<ViewRaster | null> => {
  const bbox4326 = transformExtent(
    extent25833,
    'EPSG:25833',
    'EPSG:4326',
  ) as LocalityBbox;

  switch (spec.kind) {
    case 'lidar': {
      const wanted =
        spec.source === 'national'
          ? 'national'
          : `project:${spec.source.projectName}`;
      const sources = await enumerateLidarSources(bbox4326, spec.model);
      const source = sources.find((s) => s.key === wanted);
      // Retired upstream, or no longer covering this rectangle.
      if (!source) return null;
      const result = await extractCanvas(
        extent25833,
        source,
        spec.style,
        signal,
      );
      return result
        ? { canvas: result.canvas, extent25833: result.bbox25833 }
        : null;
    }

    case 'terrain': {
      const render = await renderTerrain(bbox4326, {
        vis: spec.vis,
        model: spec.model,
        light: {
          azimuth: spec.azimuth,
          altitude: spec.altitude,
          zFactor: spec.zFactor,
        },
        radius: spec.radius,
        signal,
      });
      return render
        ? { canvas: render.canvas, extent25833: demImageExtent(render.dem) }
        : null;
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
      return result
        ? { canvas: result.canvas, extent25833: result.bbox25833 }
        : null;
    }

    case 'sketch':
      // `map/sketchOverlay.ts` owns this one: a sketch is a transparent layer
      // at zIndex 2, not a ground.
      return null;

    case 'scene':
      // A scene is a statement about the stack, not a layer in it; the one
      // place it becomes pixels is its own flatten, in the pin queue. A pinned
      // one laid as the arrival cover never reaches here — the branch above
      // paints that flatten — so this arm is the unpinned case, which has
      // nothing to show.
      return null;
  }
};

/**
 * One record's ground pixels, outside React, for callers that must composite.
 * The hook below deliberately does not use it: on the map a pinned figure goes
 * to `setGroundOverlay` as the `<img>` itself, since a 36 Mpx intermediate
 * canvas per member is ~140 MB of nothing.
 *
 * Returns null for a sketch: its pin is drawn on white paper, so laying it
 * over a ground would erase the ground.
 */
export const groundRasterOf = async (
  rec: AttachmentRecord,
  signal: AbortSignal,
): Promise<ViewRaster | null> => {
  const meta = rec.meta;
  if (!meta || rec.kind === 'sketch') return null;
  const extent25833 = groundExtentOf(meta);
  if (!extent25833) return null;

  if (isPinned(rec)) {
    try {
      const img = new Image();
      img.src = getAttachmentUrl(rec);
      await img.decode();
      const crop = cropOf(meta, img);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(crop.width));
      canvas.height = Math.max(1, Math.round(crop.height));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(
          img,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        return { canvas, extent25833 };
      }
    } catch (e) {
      // A View is reproducible, so an unloadable file falls through to a live
      // render rather than failing.
      console.warn('[groundView] pinned figure unusable', rec.id, e);
    }
  }

  const spec = viewSpecOf(rec);
  return spec ? renderViewRaster(spec, extent25833, signal) : null;
};

/**
 * Put one attachment on the ground under `key`, and take it down again; `null`
 * is "nothing here". `failed` means only a File with no usable bytes or a View
 * whose upstream has nothing over the rectangle — a View's broken figure falls
 * through to a live render instead.
 */
export const useGroundView = (
  key: string,
  rec: AttachmentRecord | null,
): { failed: boolean } => {
  const [failed, setFailed] = useState(false);

  // Keyed on identity and meta, not the whole record: the attachment list is
  // rebuilt on every realtime event, and re-decoding a several-megabyte PNG
  // because a caption changed would flash the map.
  const id = rec?.id ?? null;
  const metaKey = rec?.meta ? JSON.stringify(rec.meta) : null;

  useEffect(() => {
    setFailed(false);
    if (!rec?.meta) {
      setGroundOverlay(key, null);
      return;
    }
    const extent25833 = groundExtentOf(rec.meta);
    if (!extent25833) {
      setGroundOverlay(key, null);
      return;
    }
    const meta = rec.meta;
    const spec = viewSpecOf(rec);

    let cancelled = false;
    // Switching records aborts the render before it, so walking the rail
    // leaves at most one stitch in flight.
    const ac = new AbortController();

    const goLive = () => {
      if (!spec) {
        setFailed(true);
        return;
      }
      void withDeadline(
        LIVE_RENDER_DEADLINE_MS,
        `${spec.kind} live render`,
        (deadline) => {
          // Producers take a single signal, so fold the deadline into `ac`.
          deadline.addEventListener('abort', () => ac.abort(deadline.reason));
          return renderViewRaster(spec, extent25833, ac.signal);
        },
      )
        .then((raster) => {
          if (cancelled) return;
          if (!raster) {
            setFailed(true);
            return;
          }
          setGroundOverlay(key, {
            source: raster.canvas,
            crop: {
              x: 0,
              y: 0,
              width: raster.canvas.width,
              height: raster.canvas.height,
            },
            extent25833: raster.extent25833,
          });
        })
        .catch((e) => {
          if (cancelled) return;
          console.warn('[groundView] live render failed', id, e);
          setFailed(true);
        });
    };

    if (isPinned(rec)) {
      // The original, never a thumbnail: a legacy record's `meta.imageRect`
      // is in the original file's pixels and nothing records that file's own
      // width, so a thumb cannot be scaled back to the ground without
      // guessing.
      const img = new Image();
      img.src = getAttachmentUrl(rec);
      img
        .decode()
        .then(() => {
          if (cancelled) return;
          setGroundOverlay(key, {
            source: img,
            crop: cropOf(meta, img),
            extent25833,
          });
        })
        .catch(() => {
          if (cancelled) return;
          goLive();
        });
    } else {
      goLive();
    }

    // Must not take the member down: swapping bilder runs this, and
    // withdrawing here would blank the map until the next image arrives.
    // Taking it down is the `rec == null` branch and the unmount cleanup.
    return () => {
      cancelled = true;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, metaKey, key]);

  useEffect(() => () => setGroundOverlay(key, null), [key]);

  return { failed };
};
