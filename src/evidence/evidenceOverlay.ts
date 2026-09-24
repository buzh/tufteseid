import { useAtomValue } from 'jotai';
import type { Extent } from 'ol/extent';
import ImageLayer from 'ol/layer/Image';
import type { Size } from 'ol/size';
import ImageCanvasSource from 'ol/source/ImageCanvas';
import Static from 'ol/source/ImageStatic';
import { useEffect, useRef } from 'react';

import { mapAtom } from '../map/atoms';

// Over the terrain-analysis render (1), under the B half (1.5) so the curtain
// reads a kept render against a live ground, and under the drawing (2).
// Inventory in docs/map-layers.md.
const Z_INDEX = 1.25;

const LAYER_ID = 'spotEvidenceOverlay';
const LOOP_LAYER_ID = 'spotEvidenceLoop';

/**
 * Draws `url` over `extent`, or nothing for either missing. `opacity` is 0–1.
 * The extent is EPSG:25833 whatever the view is in; `ImageStatic` reprojects.
 */
export const useEvidenceOverlay = (
  url: string,
  extent: [number, number, number, number] | null,
  opacity: number,
) => {
  const map = useAtomValue(mapAtom);
  const [minX, minY, maxX, maxY] = extent ?? [NaN, NaN, NaN, NaN];

  // Oldest first. These outlive the effect that made them on purpose: the
  // outgoing picture comes off only once the incoming one has pixels, so that
  // flipping between two renders of one ground never blinks.
  const shown = useRef<ImageLayer<Static>[]>([]);

  useEffect(() => {
    const retireAll = () => {
      for (const layer of shown.current) map.removeLayer(layer);
      shown.current = [];
    };

    if (!url || !Number.isFinite(minX)) {
      retireAll();
      return;
    }

    const source = new Static({
      url,
      projection: 'EPSG:25833',
      imageExtent: [minX, minY, maxX, maxY],
    });
    const layer = new ImageLayer({
      source,
      opacity,
      zIndex: Z_INDEX,
      properties: { id: LAYER_ID },
    });
    map.addLayer(layer);

    const outgoing = shown.current;
    shown.current = [...outgoing, layer];

    const retireOutgoing = () => {
      for (const old of outgoing) map.removeLayer(old);
      shown.current = shown.current.filter((l) => !outgoing.includes(l));
    };
    source.once('imageloadend', retireOutgoing);
    // Or an image that never arrives leaves the previous one up for ever.
    source.once('imageloaderror', retireOutgoing);

    // No cleanup: taking this layer off is the next one's job, and the unmount
    // effect below sweeps whatever is left.

    // `opacity` is seeded here and kept in step by the effect below. Naming it
    // would rebuild the layer on every drag of the slider, and with it the
    // flash this swap exists to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, url, minX, minY, maxX, maxY]);

  useEffect(() => {
    for (const layer of shown.current) layer.setOpacity(opacity);
  }, [opacity]);

  useEffect(
    () => () => {
      for (const layer of shown.current) map.removeLayer(layer);
      shown.current = [];
    },
    [map],
  );
};

/**
 * Plays `url` over `extent`, looping, or nothing for either missing. Same
 * ground, same z and the same `opacity` as the still overlay above; the reader
 * hands a row to whichever of the two suits it, so the pair is never up at
 * once.
 *
 * `ImageStatic` takes a URL to a still and nothing else, so the frames go
 * through an `ImageCanvas` the way the terrain render does
 * (`terrain/terrainLayer.ts`). The element is the only decoder — the box shows
 * the caption, not a second copy.
 *
 * `bandTop` (0–1) is where the burnt-in legend starts. Below it the frame is a
 * caption rather than ground, so it is left off the map; the rows above it keep
 * the registration they had, because the band was blended over the picture and
 * never grew it.
 */
export const useEvidenceLoopOverlay = (
  url: string,
  extent: [number, number, number, number] | null,
  opacity: number,
  bandTop: number,
) => {
  const map = useAtomValue(mapAtom);
  const [minX, minY, maxX, maxY] = extent ?? [NaN, NaN, NaN, NaN];
  const shown = useRef<ImageLayer<ImageCanvasSource> | null>(null);

  useEffect(() => {
    if (!url || !Number.isFinite(minX)) return;

    const video = document.createElement('video');
    video.loop = true;
    // Autoplay is granted to a silent video and refused to any other; a sun
    // loop has no audio track to lose.
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    // In the document and laid out, rather than detached or `display: none`:
    // either is a candidate for a browser that stops decoding what nobody can
    // see, and the frames are wanted even though this element is not.
    video.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;pointer-events:none';
    document.body.append(video);

    // One viewport-sized canvas, reused across frames.
    let out: HTMLCanvasElement | null = null;

    const drawFrame = (
      canvasExtent: Extent,
      resolution: number,
      pixelRatio: number,
      size: Size,
    ): HTMLCanvasElement => {
      out ??= document.createElement('canvas');
      const width = Math.round(size[0]);
      const height = Math.round(size[1]);
      if (out.width !== width || out.height !== height) {
        out.width = width;
        out.height = height;
      }
      const ctx = out.getContext('2d');
      if (!ctx) return out;
      ctx.clearRect(0, 0, width, height);
      // HAVE_CURRENT_DATA. Below it there is no frame and no intrinsic size,
      // and `drawImage` of such an element throws.
      if (video.readyState < 2) return out;

      const scale = pixelRatio / resolution;
      const w = (maxX - minX) * scale;
      const h = (maxY - minY) * scale;
      // Nearest-neighbour on the way up, as the terrain render does: smoothing
      // blurs away the single-pixel step the shading exists to show.
      ctx.imageSmoothingEnabled = w < video.videoWidth;
      ctx.drawImage(
        video,
        0,
        0,
        video.videoWidth,
        Math.round(video.videoHeight * bandTop),
        (minX - canvasExtent[0]) * scale,
        (canvasExtent[3] - maxY) * scale,
        w,
        h * bandTop,
      );
      return out;
    };

    const source = new ImageCanvasSource({
      // Fixed projection, so a view in another one reprojects — here once per
      // decoded frame, which is what the `projection` URL parameter costs.
      projection: 'EPSG:25833',
      // No margin around the viewport: the picture is redrawn at the loop's
      // own rate whatever happens, so half again as many pixels buys nothing.
      ratio: 1,
      canvasFunction: drawFrame,
    });
    const layer = new ImageLayer({
      source,
      opacity,
      zIndex: Z_INDEX,
      properties: { id: LOOP_LAYER_ID },
    });
    map.addLayer(layer);
    shown.current = layer;

    // `ImageCanvas` caches one image, so `changed()` is the only way to
    // repaint. Driven off the clock and gated on the element's own time rather
    // than off `requestVideoFrameCallback`: that callback is tied to frames
    // reaching the compositor, and this element is deliberately a pixel wide
    // and all but transparent. The gate is what keeps a 24 fps loop from
    // repainting the whole map 60 times a second to show the same picture.
    let handle = 0;
    let drawn = -1;
    const tick = () => {
      handle = requestAnimationFrame(tick);
      if (video.readyState < 2 || video.currentTime === drawn) return;
      drawn = video.currentTime;
      source.changed();
    };
    tick();

    // Refused where even a silent autoplay is blocked, and then the ground
    // holds the first frame rather than nothing.
    void video.play().catch(() => {});

    return () => {
      cancelAnimationFrame(handle);
      video.pause();
      // Or the element goes on holding the decoded loop once it is off the map
      // and out of the document.
      video.removeAttribute('src');
      video.load();
      video.remove();
      map.removeLayer(layer);
      shown.current = null;
      out = null;
    };

    // `opacity` is seeded here and kept in step by the effect below. Naming it
    // would rebuild the element on every drag of the slider and restart the
    // loop from a blank ground.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, url, minX, minY, maxX, maxY, bandTop]);

  useEffect(() => {
    shown.current?.setOpacity(opacity);
  }, [opacity]);
};
