// Placing a rectangle by hand. Two surfaces read a square off the map — the
// terrain analysis and a spot's footprint — so the atoms come in as arguments
// and the same grammar serves both. The square is kept square in EPSG:25833,
// not in the view's projection.

import { useAtomValue, useStore, type Atom, type PrimitiveAtom } from 'jotai';
import { Feature } from 'ol';
import type { Coordinate } from 'ol/coordinate';
import type { FeatureLike } from 'ol/Feature';
import { containsXY } from 'ol/extent';
import Point from 'ol/geom/Point';
import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import PointerInteraction from 'ol/interaction/Pointer';
import VectorLayer from 'ol/layer/Vector';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import { transform } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import { useEffect } from 'react';
import { mapAtom } from './atoms';
import {
  bboxFromMetric,
  bboxToMetric,
  MAX_SIDE_M,
  MIN_SIDE_M,
  type Bbox,
} from './bbox';
import { cursorLease } from './cursorLease';

/** How near a corner counts as taking hold of it. */
const HANDLE_HIT_PX = 14;

const FRAME = 'rgba(255, 106, 0, 0.95)';
const CASING = 'rgba(255, 255, 255, 0.55)';

// The near-invisible fill is a hit target, not a tint on the chosen ground.
const adjustStyle = [
  new Style({
    stroke: new Stroke({ color: CASING, width: 4 }),
    fill: new Fill({ color: 'rgba(255, 106, 0, 0.06)' }),
  }),
  new Style({ stroke: new Stroke({ color: FRAME, width: 2 }) }),
];

const handleStyle = [
  new Style({
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({ color: FRAME }),
      stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.9)', width: 2 }),
    }),
  }),
];

type Metric = [number, number, number, number];

/** South-west, south-east, north-east, north-west: corner `i` is anchored by
 *  corner `i + 2`. */
const cornersOf = (e: Metric): Coordinate[] => [
  [e[0], e[1]],
  [e[2], e[1]],
  [e[2], e[3]],
  [e[0], e[3]],
];

// Indexed by corner, in `cornersOf` order.
const RESIZE_CURSORS = [
  'nesw-resize',
  'nwse-resize',
  'nesw-resize',
  'nwse-resize',
];

type Drag =
  | { kind: 'move'; from: Coordinate; start: Metric }
  | { kind: 'resize'; anchor: Coordinate; sx: number; sy: number };

export type RectAdjust = {
  /** Written on every drag frame. */
  rectAtom: PrimitiveAtom<Bbox | null>;
  /** The reader has hold of it; false takes the interaction back down. */
  activeAtom: Atom<boolean>;
  /** Names the layer for the debug inspector. */
  layerId: string;
};

/** Mount once per rectangle. Adds nothing to the map while it stands still. */
export const useRectangleAdjust = ({
  rectAtom,
  activeAtom,
  layerId,
}: RectAdjust) => {
  const map = useAtomValue(mapAtom);
  const adjusting = useAtomValue(activeAtom);
  const store = useStore();

  useEffect(() => {
    if (!adjusting) return;
    const view = map.getView().getProjection().getCode();
    // Leased, not written: other surfaces set the same cursor property and may
    // be live at the same time (`map/cursorLease.ts`).
    const cursor = cursorLease(map.getViewport());

    const toMetric = (c: Coordinate): Coordinate =>
      transform(c, view, 'EPSG:25833');
    const toView = (c: Coordinate): Coordinate =>
      transform(c, 'EPSG:25833', view);

    /** The rectangle as it stands, in metres; null once it is taken down. */
    const extentNow = (): Metric | null => {
      const bbox = store.get(rectAtom);
      return bbox ? bboxToMetric(bbox) : null;
    };

    const frame = new Feature();
    const handles = [0, 1, 2, 3].map(() => new Feature());
    const source = new VectorSource({
      wrapX: false,
      features: [frame, ...handles],
    });
    // The same level a standing frame draws at; a rectangle is never both
    // standing and in hand.
    const layer = new VectorLayer({
      zIndex: 4,
      source,
      style: (feature: FeatureLike): Style[] =>
        feature === frame ? adjustStyle : handleStyle,
      properties: { id: layerId },
    });

    const redraw = () => {
      const extent = extentNow();
      if (!extent) return;
      const ring = polygonFromExtent(extent);
      ring.transform('EPSG:25833', view);
      frame.setGeometry(ring);
      cornersOf(extent).forEach((corner, i) =>
        handles[i].setGeometry(new Point(toView(corner))),
      );
    };

    /** Which corner the pointer is over, or -1. Measured in screen pixels. */
    const cornerUnder = (event: MapBrowserEvent): number => {
      const extent = extentNow();
      if (!extent) return -1;
      let nearest = -1;
      let best = HANDLE_HIT_PX;
      cornersOf(extent).forEach((corner, i) => {
        const pixel = map.getPixelFromCoordinate(toView(corner));
        if (!pixel) return;
        const distance = Math.hypot(
          pixel[0] - event.pixel[0],
          pixel[1] - event.pixel[1],
        );
        if (distance <= best) {
          best = distance;
          nearest = i;
        }
      });
      return nearest;
    };

    let drag: Drag | null = null;

    const handleDownEvent = (event: MapBrowserEvent): boolean => {
      const extent = extentNow();
      if (!extent) return false;
      const corner = cornerUnder(event);
      if (corner >= 0) {
        const [ax, ay] = cornersOf(extent)[(corner + 2) % 4];
        const [cx, cy] = cornersOf(extent)[corner];
        // Direction fixed at grab time, not per frame: a hand dragged through
        // the anchor collapses the square rather than flipping it inside out.
        drag = {
          kind: 'resize',
          anchor: [ax, ay],
          sx: Math.sign(cx - ax),
          sy: Math.sign(cy - ay),
        };
        return true;
      }
      const here = toMetric(event.coordinate);
      if (!containsXY(extent, here[0], here[1])) return false;
      drag = { kind: 'move', from: here, start: extent };
      return true;
    };

    const handleDragEvent = (event: MapBrowserEvent) => {
      if (!drag) return;
      const here = toMetric(event.coordinate);
      let next: Metric;
      if (drag.kind === 'move') {
        // Against the rectangle as it was when the drag started, so a long drag
        // does not accumulate the reprojection's rounding into a crawl.
        const dx = here[0] - drag.from[0];
        const dy = here[1] - drag.from[1];
        const [minX, minY, maxX, maxY] = drag.start;
        next = [minX + dx, minY + dy, maxX + dx, maxY + dy];
      } else {
        const [ax, ay] = drag.anchor;
        // The longer of the two reaches, so the corner stays under the hand on
        // one axis.
        const reach = Math.max(Math.abs(here[0] - ax), Math.abs(here[1] - ay));
        const side = Math.min(Math.max(reach, MIN_SIDE_M), MAX_SIDE_M);
        const bx = ax + drag.sx * side;
        const by = ay + drag.sy * side;
        next = [
          Math.min(ax, bx),
          Math.min(ay, by),
          Math.max(ax, bx),
          Math.max(ay, by),
        ];
      }
      store.set(rectAtom, bboxFromMetric(next));
    };

    const handleUpEvent = (): boolean => {
      drag = null;
      return false;
    };

    const handleMoveEvent = (event: MapBrowserEvent) => {
      const corner = cornerUnder(event);
      const extent = extentNow();
      const here = toMetric(event.coordinate);
      cursor.set(
        corner >= 0
          ? RESIZE_CURSORS[corner]
          : extent && containsXY(extent, here[0], here[1])
            ? 'move'
            : null,
      );
    };

    const interaction = new PointerInteraction({
      handleDownEvent,
      handleDragEvent,
      handleUpEvent,
      handleMoveEvent,
    });

    redraw();
    map.addLayer(layer);
    map.addInteraction(interaction);
    // Subscribed rather than made a React dependency: the drag writes this atom
    // on every frame, and rebuilding the layer to follow it would be expensive.
    const unsubscribe = store.sub(rectAtom, redraw);

    return () => {
      unsubscribe();
      map.removeInteraction(interaction);
      map.removeLayer(layer);
      source.dispose();
      cursor.release();
    };
  }, [map, adjusting, store, rectAtom, layerId]);
};
