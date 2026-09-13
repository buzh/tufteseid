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
import { addOwnedInteraction, type InteractionOwner } from '../map/interactions';
import { clampBboxSize } from './bboxLimits';

/*
 * A rectangle you can move and resize on the map, and nothing else.
 *
 * Both surfaces that author a bbox run on this: placing a new lokalitet
 * (`useLocalityPlacement`) and reshaping an existing one (`useLocalityAdjust`,
 * "Juster området"). They differ in what they do with the result — one is
 * holding a rectangle that has no record yet, the other is writing into an edit
 * buffer — and in nothing else, which is why the gesture lives here rather than
 * twice.
 *
 * **The rectangle is a rectangle at every frame of the gesture**, which is what
 * one interaction of our own buys over the `Translate` + `Modify` pair this
 * replaced. `Modify` moves the one vertex under the hand, so a corner drag made
 * a trapezoid and the axis-aligned shape only came back on release, rebuilt
 * from the dragged corner and the opposite one. Here a grab names *which sides
 * move* — two of them for a corner, one for an edge — and every frame rebuilds
 * the extent from the pointer plus the sides that did not move. Nothing snaps
 * back afterwards because nothing was ever out of shape, and the same frame
 * goes through `clampBboxSize`, so the drag stops at the size band instead of
 * overshooting it and being pulled in on release.
 *
 * Edges are grabbable for the same reason corners are: one side is very often
 * the only thing wrong with the frame, and moving a corner to fix it costs the
 * other axis. Corners win where the two bands cross, and the interior is the
 * move.
 *
 * Two callbacks, because the two questions have different answers mid-gesture:
 * `onChange` fires on a finished gesture and is what anything downstream should
 * read, while `onLive` fires on every frame, for a readout that has to keep up
 * with the hand. Both are clamped; the difference is only how often, and
 * writing the authoritative rectangle per frame would re-render the ribbon at
 * pointer rate.
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

// Mutated per render pass by `rectangleStyle` below — the standard OL idiom for
// drawing a geometry's own vertices, and safe here because the style is read
// back synchronously by the renderer and only one of these layers is ever
// mounted (placing closes the open lokalitet, so adjust cannot also be live).
const cornerStyle = new Style({ image: handleImage(6) });
const edgeStyle = new Style({ image: handleImage(4.5) });

/**
 * The rectangle, its four corner handles and its four edge handles.
 *
 * The handles are drawn rather than merely hit-tested because they are the only
 * thing that says an edge can be taken hold of; `Modify` used to put a vertex
 * dot under the hand on hover, and nothing would have replaced it.
 */
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

/**
 * Which of two parallel edges a pixel is on, or `null` if it is near neither.
 * Nearest rather than first, so that a rectangle dragged down to a few pixels
 * across still resizes from the side the hand is actually on.
 */
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
  /** Mount the layer and the interaction while this is true. */
  active: boolean;
  /**
   * Where the rectangle starts. Read **once**, when the session begins: the
   * gesture owns the geometry from then on, and re-seeding from a prop would
   * fight the hand that is dragging it.
   */
  seed: LocalityBbox;
  /**
   * Restarts the session when it changes — the open lokalitet's id for adjust,
   * a placement's id for a new one. Keyed rather than deep-compared so that
   * "this is a different rectangle now" is something the caller states.
   */
  sessionKey: string;
  owner: InteractionOwner;
  layerId: string;
  /** A finished gesture that changed something. */
  onChange: (bbox: LocalityBbox) => void;
  /** Every frame of one. */
  onLive?: (bbox: LocalityBbox) => void;
  /** Runs on mount and its return value on unmount — see useLocalityAdjust. */
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

    /**
     * What is under the pointer. Corners are tested first and with a wider
     * band than edges: a corner is where two edge bands cross, and grabbing it
     * has to mean both axes rather than whichever edge is asked about first.
     */
    const grabAt = (pixel: number[]): Grab | null => {
      const box = currentExtent();
      if (!box) return null;
      const [left, bottom] = map.getPixelFromCoordinate([box[0], box[1]]);
      const [right, top] = map.getPixelFromCoordinate([box[2], box[3]]);
      const [x, y] = pixel;

      // Pixel y grows downwards, so the north edge is the smaller of the two.
      // Rotation is locked off app-wide, which is what lets the rectangle be
      // hit-tested as four numbers.
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

    // The cursor is the only thing that says an edge is grabbable, so this
    // interaction owns it while it is mounted — and hands it back to whatever
    // had it when the session began rather than to nothing, because Stedsinfo
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

    // `sides: null` is a body move. `before` is the rectangle as it stood when
    // the hand went down, and every frame is computed from it rather than from
    // the previous frame: absolute, so nothing accumulates drift, and it is
    // also the ceiling the clamp ratchets against.
    let drag: {
      sides: Sides | null;
      from: number[];
      before: Extent;
    } | null = null;

    const resize = (sides: Sides, to: number[], before: Extent) => {
      const [minX, minY, maxX, maxY] = before;
      const [x, y] = to;
      // Each held side follows the pointer, bounded by the one opposite it;
      // every other side stays exactly where the gesture found it. That is the
      // whole of "the corners stay square".
      const west = sides.west ? Math.min(x, maxX) : minX;
      const east = sides.east ? Math.max(x, minX) : maxX;
      const south = sides.south ? Math.min(y, maxY) : minY;
      const north = sides.north ? Math.max(y, minY) : maxY;
      // The point that does not move: the opposite corner for a corner drag,
      // and for an edge drag the opposite edge, whose other axis is unchanged
      // and therefore answers the same either way.
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
            // The ratchet: a record already over the band may be shrunk, never
            // snapped (see clampBboxSize).
            toBbox(before),
          ),
          'EPSG:4326',
          projection,
        ),
      );
    };

    // Both gestures in one interaction of our own, rather than a `Translate`
    // for the body beside something else for the handles: the two have to
    // agree about what the hand is on — a body drag that starts on an edge is
    // the bug the old `CORNER_GRAB_PX` condition existed to paper over — and
    // the cursor can only name the grab if one of them decides what it is.
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
        // Only a gesture that moved something is a change. A click on a handle
        // that goes nowhere would otherwise dirty an edit buffer.
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
