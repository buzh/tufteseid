import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { Extent } from 'ol/extent';
import ImageLayer from 'ol/layer/Image';
import type { Size } from 'ol/size';
import ImageCanvasSource from 'ol/source/ImageCanvas';
import { useEffect, useRef } from 'react';

import { mapAtom } from '../map/atoms';
import { TYPING_SURFACE } from '../ui/hints';
import { metresPerScenePx } from './frame';
import { paintRender, renderScene, type SceneRender } from './render';
import type { Sketch } from './scene';

const Z_INDEX = 2;

export const sketchShownAtom = atom(true);

export const sketchFadeAtom = atom(0);

export const sketchOnGroundAtom = atom(false);

const TOGGLE_KEY = 't';

const RESCALE_TOLERANCE = 1.4;

type Entry = {
  sketch: Sketch;
  out: HTMLCanvasElement | null;
  render: SceneRender | null;
  renderedScale: number | null;
  pending: number | null;
  live: boolean;
  redraw: () => void;
};

const ensureRender = (entry: Entry, scale: number) => {
  if (entry.pending !== null) return;
  const have = entry.renderedScale;
  if (
    have !== null &&
    scale < have * RESCALE_TOLERANCE &&
    scale * RESCALE_TOLERANCE > have
  ) {
    return;
  }
  entry.pending = scale;
  void renderScene(entry.sketch.frame, entry.sketch.elements, scale)
    .then((render) => {
      if (!entry.live) return;
      entry.pending = null;
      entry.renderedScale = scale;
      if (!render) return;
      entry.render = render;
      entry.redraw();
    })
    .catch((e) => {
      console.warn('[sketch] overlay render failed', e);
      if (!entry.live) return;
      entry.pending = null;
      entry.renderedScale = scale;
    });
};

const drawEntry =
  (entry: Entry) =>
  (
    extent: Extent,
    resolution: number,
    pixelRatio: number,
    size: Size,
  ): HTMLCanvasElement => {
    const out = (entry.out ??= document.createElement('canvas'));
    const width = Math.round(size[0]);
    const height = Math.round(size[1]);
    if (out.width !== width || out.height !== height) {
      out.width = width;
      out.height = height;
    }
    const ctx = out.getContext('2d');
    if (!ctx) return out;
    ctx.clearRect(0, 0, width, height);

    ensureRender(
      entry,
      (metresPerScenePx(entry.sketch.frame) * pixelRatio) / resolution,
    );
    if (entry.render) {
      paintRender(ctx, entry.render, extent, resolution, pixelRatio);
    }
    return out;
  };

export const useSketchOverlay = (sketch: Sketch | null) => {
  const map = useAtomValue(mapAtom);
  const [shown, setShown] = useAtom(sketchShownAtom);
  const fade = useAtomValue(sketchFadeAtom);
  const setOnGround = useSetAtom(sketchOnGroundAtom);
  const opacity = 1 - fade / 100;
  const layerRef = useRef<ImageLayer<ImageCanvasSource> | null>(null);

  useEffect(() => {
    setOnGround(sketch !== null);
    return () => setOnGround(false);
  }, [sketch, setOnGround]);

  useEffect(() => {
    if (!sketch) return;
    const entry: Entry = {
      sketch,
      out: null,
      render: null,
      renderedScale: null,
      pending: null,
      live: true,
      redraw: () => {},
    };
    const source = new ImageCanvasSource({
      projection: 'EPSG:25833',
      canvasFunction: drawEntry(entry),
    });
    entry.redraw = () => source.changed();

    const layer = new ImageLayer({
      source,
      opacity,
      visible: shown,
      zIndex: Z_INDEX,
      properties: { id: 'spotSketchOverlay' },
    });
    layerRef.current = layer;
    map.addLayer(layer);

    return () => {
      entry.live = false;
      layerRef.current = null;
      map.removeLayer(layer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, sketch]);

  useEffect(() => {
    layerRef.current?.setOpacity(opacity);
    layerRef.current?.setVisible(shown);
  }, [opacity, shown]);

  useEffect(() => {
    if (!sketch) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== TOGGLE_KEY) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(TYPING_SURFACE)) return;
      setShown((was) => !was);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sketch, setShown]);
};
