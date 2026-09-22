// Placing the rectangle by hand: drag the square to move it, drag a corner to
// resize it. Live only while `terrainAdjustingAtom` is set, which is the state
// the analysis opens in and the one `Juster` returns it to.
//
// The reason the control has this step at all is that the fetch is the
// expensive part. Framing the screen and downloading 19 MB of float in the same
// press means a reader who wanted the next valley over pays for this one first,
// and the only way back is to pan and press again. Here the square is free
// until `Start`, so it can be dragged onto the mound, pulled in to the 200 m
// that actually matters, and only then read.
//
// It writes `terrainWindowAtom` on every frame of a drag rather than on
// release. That is what makes the atom the only copy of the rectangle: the
// geometry on the map is redrawn from it through the store subscription below,
// the side length in the box reads out of it, and there is no second position
// held in a ref to disagree with either. Nothing expensive listens — the fetch
// is held off by `terrainAdjustingAtom` for exactly this reason.
//
// The square is square in EPSG:25833, like everything the producers are asked
// for, not in whatever the view is projected to. Held as a lon/lat extent
// between edits because that is what `Bbox` is.

import { useAtomValue, useStore } from 'jotai';
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
import { mapAtom } from '../map/atoms';
import { cursorLease } from '../map/cursorLease';
import {
  bboxFromMetric,
  bboxToMetric,
  MAX_SIDE_M,
  MIN_SIDE_M,
} from '../map/bbox';
import { terrainAdjustingAtom, terrainWindowAtom } from './window';

/** How near a corner counts as taking hold of it. Generous, because the
 *  alternative to grabbing the corner is moving the whole square, and one is
 *  easy to undo by eye. */
const HANDLE_HIT_PX = 14;

const FRAME = 'rgba(255, 106, 0, 0.95)';
const CASING = 'rgba(255, 255, 255, 0.55)';

// Solid rather than the dashed frame a standing analysis wears: dashes say
// "this is a note about the map", a solid edge with corners on it says "this is
// a thing you can take hold of". The fill is barely there and exists only so
// that the inside of the square is a hit target — the reader is choosing ground
// by looking at it, and tinting it would be choosing it blind.
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

/** South-west, south-east, north-east, north-west — so corner `i` is anchored
 *  by corner `i + 2`, and the two diagonals are the even and the odd pairs. */
const cornersOf = (e: Metric): Coordinate[] => [
  [e[0], e[1]],
  [e[2], e[1]],
  [e[2], e[3]],
  [e[0], e[3]],
];

// Both diagonals of an axis-aligned square, named the way a browser names them.
const RESIZE_CURSORS = [
  'nesw-resize',
  'nwse-resize',
  'nesw-resize',
  'nwse-resize',
];

type Drag =
  | { kind: 'move'; from: Coordinate; start: Metric }
  | { kind: 'resize'; anchor: Coordinate; sx: number; sy: number };

/**
 * Mount once, from the terrain controller. Adds nothing to the map while the
 * rectangle is standing still, so a running analysis carries no interaction and
 * the dashed frame (`windowLayer.ts`) is the only thing drawn.
 */
export const useTerrainWindowAdjust = () => {
  const map = useAtomValue(mapAtom);
  const adjusting = useAtomValue(terrainAdjustingAtom);
  const store = useStore();

  useEffect(() => {
    if (!adjusting) return;
    const view = map.getView().getProjection().getCode();
    // Leased, not written: the spot pin and the Kulturminner hover point at the
    // same property and may be live at the same time (`map/cursorLease.ts`).
    const cursor = cursorLease(map.getViewport());

    const toMetric = (c: Coordinate): Coordinate =>
      transform(c, view, 'EPSG:25833');
    const toView = (c: Coordinate): Coordinate =>
      transform(c, 'EPSG:25833', view);

    /** The rectangle as it stands, in metres. Null once the reader has taken
     *  the analysis down — the interaction can outlive one pointer event. */
    const extentNow = (): Metric | null => {
      const bbox = store.get(terrainWindowAtom);
      return bbox ? bboxToMetric(bbox) : null;
    };

    const frame = new Feature();
    const handles = [0, 1, 2, 3].map(() => new Feature());
    const source = new VectorSource({
      wrapX: false,
      features: [frame, ...handles],
    });
    // The same level the standing frame draws at; the two are never both up.
    const layer = new VectorLayer({
      zIndex: 4,
      source,
      style: (feature: FeatureLike): Style[] =>
        feature === frame ? adjustStyle : handleStyle,
      properties: { id: 'terrainAdjustLayer' },
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

    /** Which corner the pointer is over, or -1. Measured in pixels, because
     *  what the hand is aiming at is on the screen and a metre is a different
     *  distance at every zoom. */
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
        // The direction is fixed at grab time, not recomputed per frame: a
        // hand dragged through the anchor should collapse the square to
        // `MIN_SIDE_M` and stop, not flip it inside out and grow it again.
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
        // Against the rectangle as it was when the drag started rather than
        // against the last frame, so a long drag does not accumulate the
        // reprojection's rounding into a visible crawl.
        const dx = here[0] - drag.from[0];
        const dy = here[1] - drag.from[1];
        const [minX, minY, maxX, maxY] = drag.start;
        next = [minX + dx, minY + dy, maxX + dx, maxY + dy];
      } else {
        const [ax, ay] = drag.anchor;
        // The longer of the two reaches, so the square follows whichever way
        // the hand is really going and the corner stays under it on one axis.
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
      store.set(terrainWindowAtom, bboxFromMetric(next));
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
    // Imperative rather than a React dependency: the drag writes this atom on
    // every frame, and rebuilding the layer and the interaction sixty times a
    // second to follow it would be the one expensive thing in here.
    const unsubscribe = store.sub(terrainWindowAtom, redraw);

    return () => {
      unsubscribe();
      map.removeInteraction(interaction);
      map.removeLayer(layer);
      source.dispose();
      cursor.release();
    };
  }, [map, adjusting, store]);
};
