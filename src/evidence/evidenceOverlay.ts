import { useAtomValue } from 'jotai';
import type { Extent } from 'ol/extent';
import ImageLayer from 'ol/layer/Image';
import type { Size } from 'ol/size';
import ImageCanvasSource from 'ol/source/ImageCanvas';
import Static from 'ol/source/ImageStatic';
import { useCallback, useEffect, useRef, useState } from 'react';

import { mapAtom } from '../map/atoms';

// Over the terrain-analysis render (1), under the B half (1.5) so the curtain
// reads a kept render against a live ground, and under the drawing (2).
// Inventory in docs/map-layers.md.
const Z_INDEX = 1.25;

const LAYER_ID = 'spotEvidenceOverlay';
const LOOP_LAYER_ID = 'spotEvidenceLoop';

// Extent is EPSG:25833 whatever the view is in; `ImageStatic` reprojects.
export const useEvidenceOverlay = (
  url: string,
  extent: [number, number, number, number] | null,
  opacity: number,
) => {
  const map = useAtomValue(mapAtom);
  const [minX, minY, maxX, maxY] = extent ?? [NaN, NaN, NaN, NaN];

  // Outlive their effect on purpose: the outgoing picture comes off only once
  // the incoming one has pixels, so flipping between two renders never blinks.
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

    // No cleanup: the next layer retires this one, and the unmount effect
    // sweeps whatever is left.

    // `opacity` seeded here, kept in step by the effect below: naming it would
    // rebuild the layer on every slider drag and bring back the flash this
    // avoids.
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

// Loop controls in the loop's own terms, not the element's: progress 0–1.
export type LoopTransport = {
  playing: boolean;
  progress: number;
  /** The element has read the loop's length; until then there is nothing to seek
   *  over, and a browser that refused the file never gets there. */
  ready: boolean;
  toggle: () => void;
  seek: (progress: number) => void;
};

// Same ground, z and `opacity` as the still overlay; only one of the two is
// ever up. `ImageStatic` takes only a still URL, so frames go through an
// `ImageCanvas` as the terrain render does (`terrain/terrainLayer.ts`), with
// the element as the only decoder. `bandTop` (0–1) is where the burnt-in legend
// starts; below it the frame is caption, not ground, so it is left off the map.
export const useEvidenceLoopOverlay = (
  url: string,
  extent: [number, number, number, number] | null,
  opacity: number,
  bandTop: number,
): LoopTransport => {
  const map = useAtomValue(mapAtom);
  const [minX, minY, maxX, maxY] = extent ?? [NaN, NaN, NaN, NaN];
  const shown = useRef<ImageLayer<ImageCanvasSource> | null>(null);
  // Owned by the effect, the only thing that may make or discard one.
  const element = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!url || !Number.isFinite(minX)) return;

    const video = document.createElement('video');
    video.loop = true;
    // Autoplay needs a silent video; a sun loop has no audio track to lose.
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    // In the document and laid out, not detached or `display: none`: either
    // lets a browser stop decoding what nobody sees, and the frames are wanted.
    video.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;pointer-events:none';
    document.body.append(video);
    element.current = video;

    // The element is the state, read back rather than trusted: an autoplay may
    // be refused, and a button trusting its own request would offer to pause a
    // still.
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    // A WebM whose header lost its Duration reads back as `Infinity`, which is
    // a length nothing can be placed along.
    const onDuration = () =>
      setReady(Number.isFinite(video.duration) && video.duration > 0);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('durationchange', onDuration);

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
      // Below HAVE_CURRENT_DATA there is no frame or intrinsic size, and
      // `drawImage` of such an element throws.
      if (video.readyState < 2) return out;

      const scale = pixelRatio / resolution;
      const w = (maxX - minX) * scale;
      const h = (maxY - minY) * scale;
      // Nearest-neighbour on the way up: smoothing blurs the single-pixel step
      // the shading exists to show.
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
        h,
      );
      return out;
    };

    const source = new ImageCanvasSource({
      // Fixed, so a view in another projection reprojects once per decoded
      // frame.
      projection: 'EPSG:25833',
      // No margin: the picture is redrawn at the loop's own rate regardless, so
      // extra pixels buy nothing.
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

    // `ImageCanvas` caches one image, so `changed()` is the only repaint. Gated
    // on the element's own time, not `requestVideoFrameCallback` (tied to the
    // compositor, and this element is a transparent pixel), so a 24 fps loop
    // does not repaint the map 60 times a second for the same picture.
    let handle = 0;
    let drawn = -1;
    const tick = () => {
      handle = requestAnimationFrame(tick);
      if (video.readyState < 2 || video.currentTime === drawn) return;
      drawn = video.currentTime;
      // The seek bar says which azimuth is on the ground, so it tracks the
      // frame.
      if (video.duration > 0) setProgress(video.currentTime / video.duration);
      source.changed();
    };
    tick();

    // Refused where even a silent autoplay is blocked; then the ground holds
    // the first frame.
    void video.play().catch(() => {});

    return () => {
      cancelAnimationFrame(handle);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('durationchange', onDuration);
      video.pause();
      // Or the element goes on holding the decoded loop after it leaves the
      // map.
      video.removeAttribute('src');
      video.load();
      video.remove();
      map.removeLayer(layer);
      shown.current = null;
      element.current = null;
      out = null;
      setPlaying(false);
      setProgress(0);
      setReady(false);
    };

    // `opacity` seeded here, kept in step by the effect below: naming it would
    // rebuild the element on every slider drag and restart the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, url, minX, minY, maxX, maxY, bandTop]);

  useEffect(() => {
    shown.current?.setOpacity(opacity);
  }, [opacity]);

  const toggle = useCallback(() => {
    const video = element.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  }, []);

  const seek = useCallback((next: number) => {
    const video = element.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return;
    }
    // Short of the end: the duration itself wraps a looping element to frame
    // one.
    video.currentTime = Math.min(Math.max(next, 0), 0.999) * video.duration;
  }, []);

  return { playing, progress, ready, toggle, seek };
};
