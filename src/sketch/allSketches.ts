import { atom, useAtom, useAtomValue, useStore } from 'jotai';
import type { Extent } from 'ol/extent';
import {
  containsCoordinate,
  getArea,
  getHeight,
  getWidth,
  intersects,
} from 'ol/extent';
import type OlMap from 'ol/Map';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import ImageLayer from 'ol/layer/Image';
import { getPointResolution, transform } from 'ol/proj';
import type { Size } from 'ol/size';
import ImageCanvasSource from 'ol/source/ImageCanvas';
import { useEffect, useRef } from 'react';

import type { SpotRecord } from '../api/spots';
import { mapAtom } from '../map/atoms';
import { placeInfoArmedAtom } from '../placeInfo/atoms';
import {
  getUrlParameter,
  removeUrlParameter,
  setUrlParameter,
} from '../shared/utils/urlUtils';
import { activeSpotAtom, spotDraftAtom, spotPlacingAtom } from '../spots/atoms';
import { spotsAtPixel } from '../spots/hitTest';
import { spotRecordsAtom } from '../spots/spotRecords';
import { TYPING_SURFACE } from '../ui/hints';
import { sketchExtentIn } from './bounds';
import { metresPerScenePx } from './frame';
import { paintRender, renderScene, type SceneRender } from './render';
import { mapSketchOf, type Sketch } from './scene';
import { sketchSessionAtom } from './session';

const Z_INDEX = 1.9;

const LAYER_ID = 'allSketchesLayer';

const TOGGLE_KEY = 'a';

export const allSketchesShownAtom = atom(
  getUrlParameter('sketches') !== 'false',
);

export const drawnSketchSpotsAtom = atom<ReadonlySet<string>>(
  new Set<string>(),
);

const RESCALE_TOLERANCE = 1.4;

const MIN_ON_SCREEN_PX = 24;

const MAX_IN_FLIGHT = 2;

const MAX_RENDER_PIXELS = 4000000;

const MAX_KEPT_RENDERS = 40;

const HIT_ALPHA = 8;

const HIT_TOLERANCE_PX = 6;

type Entry = {
  record: SpotRecord;
  sketch: Sketch;
  extent: Extent;
  render: SceneRender | null;
  renderedScale: number | null;
  pending: boolean;
};

type State = {
  entries: Map<string, Entry>;
  inFlight: number;
  out: HTMLCanvasElement | null;
  redraw: () => void;
  standing: ReadonlySet<string>;
  publish: (ids: ReadonlySet<string>) => void;
};

const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
};

const needsRender = (entry: Entry, scale: number): boolean =>
  entry.renderedScale === null ||
  scale >= entry.renderedScale * RESCALE_TOLERANCE ||
  scale * RESCALE_TOLERANCE <= entry.renderedScale;

const startRender = (state: State, entry: Entry, scale: number) => {
  state.inFlight += 1;
  entry.pending = true;
  const settle = () => {
    state.inFlight -= 1;
    entry.pending = false;
    entry.renderedScale = scale;
  };
  void renderScene(
    entry.sketch.frame,
    entry.sketch.elements,
    scale,
    MAX_RENDER_PIXELS,
  )
    .then((render) => {
      settle();
      if (state.entries.get(entry.record.id) !== entry) return;
      if (!render) return;
      entry.render = render;
      state.redraw();
    })
    .catch((e) => {
      console.warn('[sketch] shared layer render failed', e);
      settle();
    });
};

const drawAll =
  (state: State) =>
  (
    extent: Extent,
    resolution: number,
    pixelRatio: number,
    size: Size,
  ): HTMLCanvasElement => {
    const out = (state.out ??= document.createElement('canvas'));
    const width = Math.round(size[0]);
    const height = Math.round(size[1]);
    if (out.width !== width || out.height !== height) {
      out.width = width;
      out.height = height;
    }
    const ctx = out.getContext('2d');
    if (!ctx) return out;
    ctx.clearRect(0, 0, width, height);

    const wanted: { entry: Entry; scale: number; span: number }[] = [];
    const offScreen: Entry[] = [];
    const standing = new Set<string>();
    let kept = 0;

    for (const entry of state.entries.values()) {
      if (!intersects(entry.extent, extent)) {
        if (entry.render) offScreen.push(entry);
        continue;
      }
      const span =
        Math.max(getWidth(entry.extent), getHeight(entry.extent)) / resolution;
      if (span < MIN_ON_SCREEN_PX) continue;
      if (entry.render) {
        kept += 1;
        standing.add(entry.record.id);
        paintRender(ctx, entry.render, extent, resolution, pixelRatio);
      }
      const scale =
        (metresPerScenePx(entry.sketch.frame) * pixelRatio) / resolution;
      if (!entry.pending && needsRender(entry, scale)) {
        wanted.push({ entry, scale, span });
      }
    }

    wanted.sort((a, b) => b.span - a.span);
    for (const next of wanted) {
      if (state.inFlight >= MAX_IN_FLIGHT) break;
      startRender(state, next.entry, next.scale);
    }

    if (kept + offScreen.length > MAX_KEPT_RENDERS) {
      for (const entry of offScreen) {
        entry.render = null;
        entry.renderedScale = null;
      }
    }

    state.publish(standing);
    return out;
  };

const alphaHit = (
  render: SceneRender,
  [x, y]: number[],
  toleranceM: number,
): boolean => {
  const [minX, minY, maxX, maxY] = render.extent25833;
  const perMetreX = render.canvas.width / (maxX - minX);
  const perMetreY = render.canvas.height / (maxY - minY);
  const left = Math.floor((x - toleranceM - minX) * perMetreX);
  const right = Math.ceil((x + toleranceM - minX) * perMetreX);
  const top = Math.floor((maxY - y - toleranceM) * perMetreY);
  const bottom = Math.ceil((maxY - y + toleranceM) * perMetreY);
  const clampedLeft = Math.max(0, left);
  const clampedTop = Math.max(0, top);
  const clampedRight = Math.min(render.canvas.width, right);
  const clampedBottom = Math.min(render.canvas.height, bottom);
  if (clampedRight <= clampedLeft || clampedBottom <= clampedTop) return false;

  const ctx = render.canvas.getContext('2d');
  if (!ctx) return false;
  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(
      clampedLeft,
      clampedTop,
      clampedRight - clampedLeft,
      clampedBottom - clampedTop,
    ).data;
  } catch {
    return false;
  }
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] > HIT_ALPHA) return true;
  }
  return false;
};

const sketchAtPixel = (
  state: State,
  map: OlMap,
  pixel: number[],
): SpotRecord | null => {
  const view = map.getView();
  const coordinate = map.getCoordinateFromPixel(pixel);
  if (!coordinate) return null;
  const projection = view.getProjection();
  const metresPerPx = getPointResolution(
    projection,
    view.getResolution() ?? 1,
    coordinate,
  );
  const toleranceM = metresPerPx * HIT_TOLERANCE_PX;
  const ground = transform(coordinate, projection, 'EPSG:25833');

  let hit: SpotRecord | null = null;
  let smallest = Infinity;
  for (const entry of state.entries.values()) {
    const render = entry.render;
    if (!render) continue;
    if (!containsCoordinate(render.extent25833, ground)) continue;
    const area = getArea(render.extent25833);
    if (area >= smallest) continue;
    if (!alphaHit(render, ground, toleranceM)) continue;
    hit = entry.record;
    smallest = area;
  }
  return hit;
};

export const useAllSketchesLayer = () => {
  const map = useAtomValue(mapAtom);
  const [shown, setShown] = useAtom(allSketchesShownAtom);
  const records = useAtomValue(spotRecordsAtom);
  const [active, setActive] = useAtom(activeSpotAtom);
  const draft = useAtomValue(spotDraftAtom);
  const penHasTheMap = useAtomValue(sketchSessionAtom) !== null;
  const store = useStore();

  const stateRef = useRef<State | null>(null);
  const layerRef = useRef<ImageLayer<ImageCanvasSource> | null>(null);

  useEffect(() => {
    const state: State = {
      entries: new Map(),
      inFlight: 0,
      out: null,
      redraw: () => {},
      standing: new Set<string>(),
      publish: (ids) => {
        if (sameIds(ids, state.standing)) return;
        state.standing = ids;
        queueMicrotask(() => {
          if (stateRef.current !== state) return;
          store.set(drawnSketchSpotsAtom, ids);
        });
      },
    };
    const source = new ImageCanvasSource({
      projection: 'EPSG:25833',
      canvasFunction: drawAll(state),
    });
    state.redraw = () => source.changed();
    stateRef.current = state;

    const layer = new ImageLayer({
      source,
      visible: false,
      zIndex: Z_INDEX,
      properties: { id: LAYER_ID },
    });
    layerRef.current = layer;
    map.addLayer(layer);

    return () => {
      state.redraw = () => {};
      stateRef.current = null;
      layerRef.current = null;
      map.removeLayer(layer);
      store.set(drawnSketchSpotsAtom, new Set<string>());
    };
  }, [map, store]);

  useEffect(() => {
    layerRef.current?.setVisible(shown);
    if (shown) {
      removeUrlParameter('sketches');
    } else {
      setUrlParameter('sketches', false);
      const state = stateRef.current;
      if (state) state.standing = new Set<string>();
      store.set(drawnSketchSpotsAtom, new Set<string>());
    }
  }, [map, shown, store]);

  const skipActive = active?.id ?? null;
  const skipDraft = draft?.recordId ?? null;

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const next = new Map<string, Entry>();
    for (const record of records ?? []) {
      if (record.id === skipActive || record.id === skipDraft) continue;
      const sketch = mapSketchOf(record);
      if (!sketch) continue;
      const extent = sketchExtentIn(sketch, 'EPSG:25833');
      if (!extent) continue;
      const held = state.entries.get(record.id);
      if (held && held.record.updated === record.updated) {
        held.record = record;
        next.set(record.id, held);
      } else {
        next.set(record.id, {
          record,
          sketch,
          extent,
          render: null,
          renderedScale: null,
          pending: false,
        });
      }
    }
    state.entries = next;
    state.redraw();
  }, [records, skipActive, skipDraft]);

  useEffect(() => {
    if (!shown) return;
    const onClick = (event: MapBrowserEvent) => {
      const state = stateRef.current;
      if (!state) return;
      if (
        store.get(spotDraftAtom) ||
        store.get(spotPlacingAtom) ||
        store.get(placeInfoArmedAtom)
      ) {
        return;
      }
      if (spotsAtPixel(map, event.pixel)) return;
      const record = sketchAtPixel(state, map, event.pixel);
      if (record) setActive(record);
    };
    map.on('singleclick', onClick);
    return () => {
      map.un('singleclick', onClick);
    };
  }, [map, shown, store, setActive]);

  useEffect(() => {
    if (penHasTheMap) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== TOGGLE_KEY) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(TYPING_SURFACE)) return;
      setShown((was) => !was);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [penHasTheMap, setShown]);
};
