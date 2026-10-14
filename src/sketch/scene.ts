import type { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';

import {
  MAP_SKETCH_COLUMN,
  type SpotRecord,
  type SpotSketch,
} from '../api/spots';
import { frameExtentIn, type SketchFrame } from './frame';

export type SceneElement = NonNullable<
  ExcalidrawInitialDataState['elements']
>[number];

export type Sketch = {
  frame: SketchFrame;
  elements: readonly SceneElement[];
};

const VOLATILE = ['version', 'versionNonce', 'updated'] as const;

export const storableScene = (
  elements: readonly SceneElement[],
): SceneElement[] =>
  elements
    .filter((el) => !el.isDeleted)
    .map((el) => {
      const copy = { ...el } as Record<string, unknown>;
      for (const key of VOLATILE) delete copy[key];
      return copy as unknown as SceneElement;
    });

type Reframing = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  scale: number;
};

const SETTLED_PX = 0.001;

const SETTLED_SCALE = 0.00001;

const reframing = (from: SketchFrame, to: SketchFrame): Reframing | null => {
  const source = frameExtentIn(from, to.projection);
  const spanX = to.extent[2] - to.extent[0];
  const spanY = to.extent[3] - to.extent[1];
  if (!(spanX > 0) || !(spanY > 0)) return null;
  const ax = ((source[2] - source[0]) / from.widthPx) * (to.widthPx / spanX);
  const ay = ((source[3] - source[1]) / from.heightPx) * (to.heightPx / spanY);
  if (!(ax > 0) || !(ay > 0)) return null;
  const bx = ((source[0] - to.extent[0]) / spanX) * to.widthPx;
  const by = ((to.extent[3] - source[3]) / spanY) * to.heightPx;
  if (
    Math.abs(ax - 1) < SETTLED_SCALE &&
    Math.abs(ay - 1) < SETTLED_SCALE &&
    Math.abs(bx) < SETTLED_PX &&
    Math.abs(by) < SETTLED_PX
  ) {
    return null;
  }
  return { ax, ay, bx, by, scale: Math.sqrt(ax * ay) };
};

const SCALED = ['fontSize', 'strokeWidth'] as const;

const SCENE_PX_PRECISION = 100;

const trimmed = (value: number): number =>
  Math.round(value * SCENE_PX_PRECISION) / SCENE_PX_PRECISION;

const scaledNumber = (value: unknown, by: number): unknown =>
  typeof value === 'number' && Number.isFinite(value)
    ? trimmed(value * by)
    : value;

const reframeElement = (el: SceneElement, at: Reframing): SceneElement => {
  const copy = { ...el } as Record<string, unknown>;
  copy.x = trimmed(at.ax * el.x + at.bx);
  copy.y = trimmed(at.ay * el.y + at.by);
  copy.width = trimmed(el.width * at.scale);
  copy.height = trimmed(el.height * at.scale);
  if (Array.isArray(copy.points)) {
    copy.points = (copy.points as unknown[]).map((point) =>
      Array.isArray(point)
        ? point.map((value) => scaledNumber(value, at.scale))
        : point,
    );
  }
  const roundness = copy.roundness as { value?: unknown } | null | undefined;
  if (roundness && typeof roundness.value === 'number') {
    copy.roundness = {
      ...roundness,
      value: trimmed(roundness.value * at.scale),
    };
  }
  for (const key of SCALED) {
    if (key in copy) copy[key] = scaledNumber(copy[key], at.scale);
  }
  return copy as unknown as SceneElement;
};

export const reframeScene = (
  sketch: Sketch,
  frame: SketchFrame,
): readonly SceneElement[] => {
  const at = reframing(sketch.frame, frame);
  return at
    ? sketch.elements.map((el) => reframeElement(el, at))
    : sketch.elements;
};

export const SKETCH_BUDGET_BYTES = 4000000;

export const sketchBytes = (sketch: SpotSketch | null): number =>
  sketch ? new TextEncoder().encode(JSON.stringify(sketch)).length : 0;

export const sketchOf = (
  value: SpotSketch | null | undefined,
): Sketch | null => {
  if (!value || typeof value !== 'object') return null;
  const frame = value.frame as Partial<SketchFrame> | undefined;
  if (!frame || typeof frame !== 'object') return null;
  if (typeof frame.projection !== 'string' || frame.projection === '') {
    return null;
  }
  if (
    !Array.isArray(frame.extent) ||
    frame.extent.length !== 4 ||
    !frame.extent.every((v) => typeof v === 'number' && Number.isFinite(v))
  ) {
    return null;
  }
  if (
    typeof frame.widthPx !== 'number' ||
    typeof frame.heightPx !== 'number' ||
    !(frame.widthPx > 0) ||
    !(frame.heightPx > 0)
  ) {
    return null;
  }
  if (!Array.isArray(value.elements) || value.elements.length === 0) {
    return null;
  }
  return {
    frame: {
      projection: frame.projection,
      extent: frame.extent as [number, number, number, number],
      widthPx: frame.widthPx,
      heightPx: frame.heightPx,
    },
    elements: value.elements as SceneElement[],
  };
};

export const mapSketchOf = (spot: SpotRecord): Sketch | null => {
  const chosen = spot.mapSketch;
  if (chosen != null && chosen !== '' && chosen !== MAP_SKETCH_COLUMN) {
    return null;
  }
  return sketchOf(spot.sketch);
};
