import { useAtomValue } from 'jotai';
import type { Extent } from 'ol/extent';
import ImageLayer from 'ol/layer/Image';
import type { Size } from 'ol/size';
import ImageCanvasSource from 'ol/source/ImageCanvas';
import Static from 'ol/source/ImageStatic';
import { useCallback, useEffect, useRef, useState } from 'react';

import { mapAtom } from '../map/atoms';

const Z_INDEX = 1.25;

const LAYER_ID = 'spotEvidenceOverlay';
const LOOP_LAYER_ID = 'spotEvidenceLoop';

export const useEvidenceOverlay = (
  url: string,
  extent: [number, number, number, number] | null,
  opacity: number,
) => {
  const map = useAtomValue(mapAtom);
  const [minX, minY, maxX, maxY] = extent ?? [NaN, NaN, NaN, NaN];

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

    source.once('imageloaderror', retireOutgoing);

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

export type LoopTransport = {
  playing: boolean;
  progress: number;

  ready: boolean;
  toggle: () => void;
  seek: (progress: number) => void;
};

export const useEvidenceLoopOverlay = (
  url: string,
  extent: [number, number, number, number] | null,
  opacity: number,
  bandTop: number,
): LoopTransport => {
  const map = useAtomValue(mapAtom);
  const [minX, minY, maxX, maxY] = extent ?? [NaN, NaN, NaN, NaN];
  const shown = useRef<ImageLayer<ImageCanvasSource> | null>(null);

  const element = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!url || !Number.isFinite(minX)) return;

    const video = document.createElement('video');
    video.loop = true;

    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;

    video.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;pointer-events:none';
    document.body.append(video);
    element.current = video;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    const onDuration = () =>
      setReady(Number.isFinite(video.duration) && video.duration > 0);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('durationchange', onDuration);

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

      if (video.readyState < 2) return out;

      const scale = pixelRatio / resolution;
      const w = (maxX - minX) * scale;
      const h = (maxY - minY) * scale;

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

      projection: 'EPSG:25833',

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

    let handle = 0;
    let drawn = -1;
    const tick = () => {
      handle = requestAnimationFrame(tick);
      if (video.readyState < 2 || video.currentTime === drawn) return;
      drawn = video.currentTime;

      if (video.duration > 0) setProgress(video.currentTime / video.duration);
      source.changed();
    };
    tick();

    void video.play().catch(() => {});

    return () => {
      cancelAnimationFrame(handle);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('durationchange', onDuration);
      video.pause();

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

    video.currentTime = Math.min(Math.max(next, 0), 0.999) * video.duration;
  }, []);

  return { playing, progress, ready, toggle, seek };
};
