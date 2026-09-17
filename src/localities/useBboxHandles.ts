import { useAtomValue } from 'jotai';
import { Feature } from 'ol';
import type { Extent } from 'ol/extent';
import type { FeatureLike } from 'ol/Feature';
import { MultiPoint, Polygon } from 'ol/geom';
import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import PointerInteraction from 'ol/interaction/Pointer';
import VectorLayer from 'ol/layer/Vector';
import { transform, transformExtent } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import CircleStyle from 'ol/style/Circle';
import { useEffect, useRef } from 'react';
import { LocalityBbox } from '../api/localities';
import { mapAtom } from '../map/atoms';
import {
  addOwnedInteraction,
  type InteractionOwner,
} from '../map/interactions';
import { clampBboxSize } from './bboxLimits';

/*
 * A rectangle you can move and resize; both `useLocalityPlacement` and
 * `useLocalityAdjust` run on it. A grab names which sides move, and each frame
 * rebuilds the extent from the pointer plus the sides that did not, through
 * `clampBboxSize`, so the drag stops at the band rather than snapping back on
 * release. `onChange` is the finished gesture; `onLive` is every frame of one,
 * because writing the record per frame re-renders the ribbon at pointer rate.
 */

const CORNER_GRAB_PX = 12;
const EDGE_GRAB_PX = 8;

const boxStyle = new Style({
  stroke: new Stroke({ color: '#FF6A00', width: 3 }),
  fill: new Fill({ color: 'rgba(255, 106, 0, 0.10)' }),
});

const handleImage = (radius: number) =>
  new CircleStyle({
    radius,
    fill: new Fill({ color: '#ffffff' }),
    stroke: new Stroke({ color: '#FF6A00', width: 2 }),
  });

// Mutated per render pass by `rectangleStyle`, the OL idiom for drawing a
// geometry's own vertices; the renderer reads it back synchronously.
const cornerStyle = new Style({ image: handleImage(6) });
const edgeStyle = new Style({ image: handleImage(4.5) });

// Drawn, not merely hit-tested: the handles are what say an edge is grabbable.
const rectangleStyle = (feature: FeatureLike): Style[] => {
  const geometry = feature.getGeometry();
  if (!(geometry instanceof Polygon)) return [boxStyle];
  const [minX, minY, maxX, maxY] = geometry.getExtent();
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  cornerStyle.setGeometry(
    new MultiPoint([
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ]),
  );
  edgeStyle.setGeometry(
    new MultiPoint([
      [midX, minY],
      [maxX, midY],
      [midX, maxY],
      [minX, midY],
    ]),
  );
  return [boxStyle, cornerStyle, edgeStyle];
};

/** Which sides the hand has hold of: two for a corner, one for an edge. */
type Sides = {
  west: boolean;
  east: boolean;
  south: boolean;
  north: boolean;
};

type Grab = { kind: 'resize'; sides: Sides } | { kind: 'move' };

// Nearest, not first: a rectangle a few pixels across still resizes correctly.
const nearestSide = (
  value: number,
  low: number,
  high: number,
  slack: number,
): 'low' | 'high' | null => {
  const toLow = Math.abs(value - low);
  const toHigh = Math.abs(value - high);
  if (Math.min(toLow, toHigh) > slack) return null;
  return toLow <= toHigh ? 'low' : 'high';
};

const cursorFor = (grab: Grab | null, dragging: boolean): string => {
  if (!grab) return '';
  if (grab.kind === 'move') return dragging ? 'grabbing' : 'grab';
  const { west, east, south, north } = grab.sides;
  if ((west && north) || (east && south)) return 'nwse-resize';
  if ((east && north) || (west && south)) return 'nesw-resize';
  if (west || east) return 'ew-resize';
  return 'ns-resize';
};

export type BboxHandlesOptions = {
  active: boolean;
  /** Read once, when the session begins: re-seeding would fight the hand. */
  seed: LocalityBbox;
  /** Restarts the session when it changes; the caller states the identity. */
  sessionKey: string;
  owner: InteractionOwner;
  layerId: string;
  /** A finished gesture that changed something. */
  onChange: (bbox: LocalityBbox) => void;
  /** Every frame of one. */
  onLive?: (bbox: LocalityBbox) => void;
  /** Runs on mount, its return value on unmount. */
  onMount?: () => () => void;
};

export const useBboxHandles = ({
  active,
  seed,
  sessionKey,
  owner,
  layerId,
  onChange,
  onLive,
  onMount,
}: BboxHandlesOptions) => {
  const map = useAtomValue(mapAtom);

  const seedRef = useRef(seed);
  seedRef.current = seed;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;
  const onMountRef = useRef(onMount);
  onMountRef.current = onMount;

  useEffect(() => {
    if (!active) return;

    const projection = map.getView().getProjection().getCode();
    const toBbox = (extent: number[]) =>
      transformExtent(extent, projection, 'EPSG:4326') as LocalityBbox;

    const extent = transformExtent(seedRef.current, 'EPSG:4326', projection);
    const feature = new Feature({ geometry: polygonFromExtent(extent) });
    const source = new VectorSource({ features: [feature] });
    const layer = new VectorLayer({
      source,
      zIndex: 8,
      style: rectangleStyle,
      properties: { id: layerId },
    });
    map.addLayer(layer);
    const unmount = onMountRef.current?.();

    feature.on('change', () => {
      const geometry = feature.getGeometry();
      if (!(geometry instanceof Polygon)) return;
      onLiveRef.current?.(toBbox(geometry.getExtent()));
    });

    const currentExtent = (): Extent | null => {
      const geometry = feature.getGeometry();
      return geometry instanceof Polygon ? geometry.getExtent() : null;
    };

    const apply = (next: Extent) => {
      const geometry = feature.getGeometry();
      if (!(geometry instanceof Polygon)) return;
      geometry.setCoordinates(polygonFromExtent(next).getCoordinates());
    };

    // Corners are tested first and wider, so a crossing band means both axes.
    const grabAt = (pixel: number[]): Grab | null => {
      const box = currentExtent();
      if (!box) return null;
      const [left, bottom] = map.getPixelFromCoordinate([box[0], box[1]]);
      const [right, top] = map.getPixelFromCoordinate([box[2], box[3]]);
      const [x, y] = pixel;

      // Pixel y grows downwards, so north is the smaller. Rotation is off
      // app-wide, which is what lets this be four numbers.
      const corner = {
        x: nearestSide(x, left, right, CORNER_GRAB_PX),
        y: nearestSide(y, top, bottom, CORNER_GRAB_PX),
      };
      if (corner.x && corner.y) {
        return {
          kind: 'resize',
          sides: {
            west: corner.x === 'low',
            east: corner.x === 'high',
            north: corner.y === 'low',
            south: corner.y === 'high',
          },
        };
      }

      const insideX = x >= left - EDGE_GRAB_PX && x <= right + EDGE_GRAB_PX;
      const insideY = y >= top - EDGE_GRAB_PX && y <= bottom + EDGE_GRAB_PX;
      const vertical = nearestSide(x, left, right, EDGE_GRAB_PX);
      if (vertical && insideY) {
        return {
          kind: 'resize',
          sides: {
            west: vertical === 'low',
            east: vertical === 'high',
            north: false,
            south: false,
          },
        };
      }
      const horizontal = nearestSide(y, top, bottom, EDGE_GRAB_PX);
      if (horizontal && insideX) {
        return {
          kind: 'resize',
          sides: {
            west: false,
            east: false,
            north: horizontal === 'low',
            south: horizontal === 'high',
          },
        };
      }
      return insideX && insideY ? { kind: 'move' } : null;
    };

    // Owns the cursor while mounted and hands back whatever had it — Stedsinfo
    // keeps a `crosshair` on the same element for as long as it is armed.
    const viewport = map.getViewport();
    const restCursor = viewport.style.cursor;
    let cursor = restCursor;
    const setCursor = (next: string) => {
      const value = next || restCursor;
      if (value === cursor) return;
      cursor = value;
      viewport.style.cursor = value;
    };

    // `sides: null` is a body move. Every frame is computed from `before`, the
    // rectangle as the hand found it, which is also the clamp's ratchet ceiling.
    let drag: {
      sides: Sides | null;
      from: number[];
      before: Extent;
    } | null = null;

    const resize = (sides: Sides, to: number[], before: Extent) => {
      const [minX, minY, maxX, maxY] = before;
      const [x, y] = to;
      // Each held side follows the pointer, bounded by the one opposite.
      const west = sides.west ? Math.min(x, maxX) : minX;
      const east = sides.east ? Math.max(x, minX) : maxX;
      const south = sides.south ? Math.min(y, maxY) : minY;
      const north = sides.north ? Math.max(y, minY) : maxY;
      // The point that does not move: the opposite corner or edge.
      const anchor = transform(
        [sides.west ? east : west, sides.south ? north : south],
        projection,
        'EPSG:4326',
      ) as [number, number];
      apply(
        transformExtent(
          clampBboxSize(
            toBbox([west, south, east, north]),
            anchor,
            // The ratchet: a record over the band may shrink, never snap.
            toBbox(before),
          ),
          'EPSG:4326',
          projection,
        ),
      );
    };

    // Both gestures in one interaction: only one of them can name the cursor.
    const handles = new PointerInteraction({
      handleDownEvent: (event) => {
        const original = event.originalEvent;
        if (original instanceof PointerEvent && original.button !== 0) {
          return false;
        }
        const box = currentExtent();
        if (!box) return false;
        const grab = grabAt(event.pixel);
        if (!grab) return false;
        drag = {
          sides: grab.kind === 'resize' ? grab.sides : null,
          from: [...event.coordinate],
          before: [...box],
        };
        setCursor(cursorFor(grab, true));
        return true;
      },
      handleDragEvent: (event) => {
        if (!drag) return;
        if (drag.sides) {
          resize(drag.sides, event.coordinate, drag.before);
          return;
        }
        const dx = event.coordinate[0] - drag.from[0];
        const dy = event.coordinate[1] - drag.from[1];
        const [minX, minY, maxX, maxY] = drag.before;
        apply([minX + dx, minY + dy, maxX + dx, maxY + dy]);
      },
      handleUpEvent: (event) => {
        const finished = drag;
        drag = null;
        setCursor(cursorFor(grabAt(event.pixel), false));
        const box = currentExtent();
        // A click that goes nowhere must not dirty the edit buffer.
        if (!finished || !box) return false;
        if (box.every((value, i) => value === finished.before[i])) return false;
        if (box[2] - box[0] <= 0 || box[3] - box[1] <= 0) return false;
        onChangeRef.current(toBbox(box));
        return false;
      },
      handleMoveEvent: (event) => {
        if (drag) return;
        setCursor(cursorFor(grabAt(event.pixel), false));
      },
    });

    addOwnedInteraction(map, owner, handles);

    return () => {
      map.removeInteraction(handles);
      map.removeLayer(layer);
      viewport.style.cursor = restCursor;
      unmount?.();
    };
  }, [active, map, sessionKey, owner, layerId]);
};
