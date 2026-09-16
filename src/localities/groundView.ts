// A kept bilde as a layer over its own rectangle — and for a View, its own
// pixels when there is no figure to lay down (docs/lokalitet-view.md §13.10,
// step 2).
//
// A stored image reached the map exactly two ways before this, and neither is
// the one a [Visning] member needs. `useRecreateView` applies a spec to the
// *whole map*, which answers "put the map back the way it was" and throws the
// rectangle away. `usePinnedBilde` could only paste the *pinned figure* at its
// `bbox25833`, which needs the file to exist — so a View that the pin queue
// has not reached yet, or a fork whose Views all arrived as bare specs, had
// nothing to show. This module is the third path: the spec's own pixels over
// the spec's own rectangle, produced on demand from the same four producers
// the pin queue uses.
//
// **Paint the pin where there is one; render live where there is not.** §13.2
// says a View's figure never goes on the map and argues it from sharpness —
// stretch a PNG and zooming stops helping. Building it says otherwise, and the
// measurement is worth keeping: `renderFigureBlob` fits a figure to 40 Mpx,
// and a lokalitet is 50–1500 m per side (`bboxLimits.ts`), so every producer's
// native resolution already fits inside that cap. 1500 m of LiDAR at 0.25 m/px
// is 36 Mpx; a terrain render is capped at 3000 px per side long before it.
// **A pinned figure is the source's own pixels**, cropped past the caption
// panel by `imageRect`, and there is nothing finer to upgrade it to. The one
// exception is a flyfoto over the largest rectangles — 1500 m at NiB's 0.2 m
// target is 56 Mpx, so the store fits it to 0.237 — and re-stitching the whole
// acquisition to recover 18 % is not a trade worth making on a zoom notch.
//
// So §13.2's rule survives where it does work (nobody has to choose, and an
// unpinned View is fully usable) and is dropped where it was reasoning from an
// assumption that does not hold here. What that costs is written down: there
// is no resolution ladder in this module, and adding one later means measuring
// again rather than reading it off §13.2.
//
// The figure is still the citable artifact and still pinned eagerly; none of
// this is a cache (§13.3, `pinQueue.ts`).

import { transformExtent } from 'ol/proj';
import { useEffect, useState } from 'react';
import { getAttachmentUrl, type AttachmentRecord } from '../api/attachments';
import type { LocalityBbox } from '../api/localities';
import { extractCanvas } from '../lidarExtract/run';
import { enumerateLidarSources } from '../lidarExtract/sources';
import { setGroundOverlay, type GroundOverlayKey } from '../map/groundOverlay';
import { withDeadline } from '../shared/utils/deadline';
import { renderTerrain } from '../terrain/render';
import { fetchFlyfoto } from './flyfoto';
import { fetchFlyfotoProjectsForBbox } from './flyfotoProjects';
import { isPinned, viewSpecOf, type ViewSpec } from './viewSpec';

/*
 * The same ceiling the pin queue puts on a render, and the same number
 * deliberately: it is the same producer doing the same work over the same
 * rectangle, so a second figure for "this stitch has stopped making progress"
 * would only be a second way to be wrong about it. What keeps this one from
 * being felt as a five-minute wait is the abort on switching records, not a
 * shorter clock.
 */
const LIVE_RENDER_DEADLINE_MS = 300_000;

/** `[minX, minY, maxX, maxY]` in EPSG:25833, as every producer writes it. */
export const groundExtentOf = (meta: Record<string, unknown>) => {
  const b = meta.bbox25833;
  return Array.isArray(b) &&
    b.length === 4 &&
    b.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? (b as [number, number, number, number])
    : null;
};

/**
 * Where the ground sits inside the figure PNG, in that file's own pixels.
 *
 * Not optional in practice but treated as such: the caption panel is drawn
 * *below* the image (src/figure/), so a figure is taller than the rectangle it
 * shows and painting the whole file at the extent would squash the ground and
 * hang a caption off the bottom of it. Anything without an imageRect predates
 * the figure work and is pixel-registered already.
 */
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

/** Ground edge to edge — no caption panel, so no crop to carry. */
type ViewRaster = {
  canvas: HTMLCanvasElement;
  extent25833: [number, number, number, number];
};

/*
 * Spec → ground pixels. The sibling of `pinQueue.renderSpec`, and deliberately
 * not the same function: that one produces the *figure* — scale bar, north
 * arrow, caption panel below the image — which is the one thing that must not
 * go on the map. The source lookups are all the two duplicate, and three lines
 * each is cheaper than entangling the citable artifact's path with the
 * screen's.
 *
 * `null` is "the source has nothing over this rectangle", which is a fact
 * about the ground rather than a failure; anything that throws is one.
 */
const renderViewRaster = async (
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
        ? { canvas: render.canvas, extent25833: render.dem.bbox25833 }
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
      // `map/sketchOverlay.ts` owns this one, and has to: a sketch is a
      // transparent layer over the ground rather than an image of it, so it
      // belongs at zIndex 2 in a set of its own — the [Skisse] group, not
      // [Visning]. Answering here would put a second copy of it on the map one
      // level down, on white paper, with a caption panel.
      return null;
  }
};

/**
 * Put one attachment on the ground under `key`, and take it down again.
 * `null` is "nothing here".
 *
 * Returns whether the record could not be shown at all — a narrower claim than
 * it looks, because for a View a figure that will not load is not one: the
 * pixels can be made again, so a missing or broken file falls through to the
 * live render rather than to an error. Only a File with no usable bytes, or a
 * View whose upstream has nothing over the rectangle, ends up `failed`.
 */
export const useGroundView = (
  key: GroundOverlayKey,
  rec: AttachmentRecord | null,
): { failed: boolean } => {
  const [failed, setFailed] = useState(false);

  // Deliberately keyed on the record's identity and its meta, not on the whole
  // record: the attachment list is rebuilt on every realtime event, and
  // re-decoding a several-megabyte PNG because somebody's caption changed
  // would flash the map.
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
    // Cancellation is what makes a live render affordable on a surface a
    // person is clicking through: walking the rail starts at most one stitch,
    // because switching records aborts the one before it rather than leaving
    // it to finish into a member nobody is looking at.
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
          // Folded into the one controller rather than combined at the call
          // site: the producers take a single signal, and this way whichever
          // of the two fires stops the same requests.
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
      // The original, never a thumbnail. `meta.imageRect` is in the original
      // file's pixels and nothing records the figure's own width, so a thumb
      // cannot be scaled back to the ground without guessing — and a guess
      // that is a pixel out is half a metre out on the map, which defeats the
      // point of registering it at all.
      getAttachmentUrl(rec)
        .then((url) => {
          const img = new Image();
          img.src = url;
          return img.decode().then(() => img);
        })
        .then((img) => {
          if (cancelled) return;
          setGroundOverlay(key, {
            source: img,
            crop: cropOf(meta, img),
            extent25833,
          });
        })
        .catch(() => {
          if (cancelled) return;
          // A View is reproducible by definition, so a file that will not load
          // is a reason to make the pixels again rather than a reason to give
          // up. A File has nothing behind it and this is as far as it goes.
          goLive();
        });
    } else {
      goLive();
    }

    // Note what this cleanup does *not* do: it does not take the member down.
    // Swapping from one bilde to another runs it, and withdrawing here would
    // blank the map for as long as the next image takes to arrive. Taking it
    // down is the `rec == null` branch above and the unmount cleanup below.
    return () => {
      cancelled = true;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, metaKey, key]);

  useEffect(() => () => setGroundOverlay(key, null), [key]);

  return { failed };
};
