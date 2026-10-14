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
import { transform, transformExtent } from 'ol/proj';
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
  type Metric,
} from './bbox';
import { cursorLease } from './cursorLease';

const HANDLE_HIT_PX = 14;

const FRAME = 'rgba(255, 106, 0, 0.95)';
const CASING = 'rgba(255, 255, 255, 0.55)';

const adjustStyle = [
  new Style({
    zIndex: 1,
    stroke: new Stroke({ color: CASING, width: 4 }),
    fill: new Fill({ color: 'rgba(255, 106, 0, 0.06)' }),
  }),
  new Style({ zIndex: 1, stroke: new Stroke({ color: FRAME, width: 2 }) }),
];

const cellStyle = [
  new Style({ zIndex: 0, stroke: new Stroke({ color: FRAME, width: 0.5 }) }),
];

const handleStyle = [
  new Style({
    zIndex: 2,
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({ color: FRAME }),
      stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.9)', width: 2 }),
    }),
  }),
];

type Grip = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

const CORNERS: Grip[] = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
];

const EDGES: Grip[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

const gripAt = (e: Metric, grip: Grip): Coordinate => [
  grip.x === 0 ? (e[0] + e[2]) / 2 : grip.x < 0 ? e[0] : e[2],
  grip.y === 0 ? (e[1] + e[3]) / 2 : grip.y < 0 ? e[1] : e[3],
];

const cursorFor = (grip: Grip): string =>
  grip.x === 0
    ? 'ns-resize'
    : grip.y === 0
      ? 'ew-resize'
      : grip.x === grip.y
        ? 'nesw-resize'
        : 'nwse-resize';

type Drag =
  | { kind: 'move'; from: Coordinate; start: Metric }
  | { kind: 'resize'; grip: Grip; start: Metric };

type RectAdjustOptions = {
  rectAtom: PrimitiveAtom<Bbox | null>;
  activeAtom: Atom<boolean>;
  layerId: string;
  maxSideM?: number;
  snap?: (extent: Metric) => Metric;
  tiles?: (bbox: Bbox) => Bbox[];
  square?: boolean;
};

export const useRectangleAdjust = ({
  rectAtom,
  activeAtom,
  layerId,
  maxSideM = MAX_SIDE_M,
  snap,
  tiles,
  square = false,
}: RectAdjustOptions) => {
  const map = useAtomValue(mapAtom);
  const adjusting = useAtomValue(activeAtom);
  const store = useStore();

  useEffect(() => {
    if (!adjusting) return;
    const view = map.getView().getProjection().getCode();
    const cursor = cursorLease(map.getViewport());

    const toMetric = (c: Coordinate): Coordinate =>
      transform(c, view, 'EPSG:25833');
    const toView = (c: Coordinate): Coordinate =>
      transform(c, 'EPSG:25833', view);

    const extentNow = (): Metric | null => {
      const bbox = store.get(rectAtom);
      return bbox ? bboxToMetric(bbox) : null;
    };

    const grips = square ? CORNERS : [...CORNERS, ...EDGES];

    const frame = new Feature();
    const knobs = grips.map(() => new Feature());
    const source = new VectorSource({
      wrapX: false,
      features: [frame, ...knobs],
    });
    const layer = new VectorLayer({
      zIndex: 4,
      source,
      style: (feature: FeatureLike): Style[] =>
        feature === frame
          ? adjustStyle
          : feature.get('cell')
            ? cellStyle
            : handleStyle,
      properties: { id: layerId },
    });

    let cells: Feature[] = [];

    const recell = (bbox: Bbox) => {
      cells.forEach((cell) => source.removeFeature(cell));
      const boxes = tiles?.(bbox) ?? [];
      cells =
        boxes.length > 1
          ? boxes.map((box) => {
              const cell = new Feature({
                geometry: polygonFromExtent(
                  transformExtent(box, 'EPSG:4326', view),
                ),
              });
              cell.set('cell', true);
              return cell;
            })
          : [];
      source.addFeatures(cells);
    };

    const redraw = () => {
      const bbox = store.get(rectAtom);
      if (!bbox) return;
      const extent = bboxToMetric(bbox);
      const ring = polygonFromExtent(extent);
      ring.transform('EPSG:25833', view);
      frame.setGeometry(ring);
      grips.forEach((grip, i) =>
        knobs[i].setGeometry(new Point(toView(gripAt(extent, grip)))),
      );
      recell(bbox);
    };

    const gripUnder = (event: MapBrowserEvent): Grip | null => {
      const extent = extentNow();
      if (!extent) return null;
      let nearest = -1;
      let best = HANDLE_HIT_PX;
      grips.forEach((grip, i) => {
        const pixel = map.getPixelFromCoordinate(toView(gripAt(extent, grip)));
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
      return nearest < 0 ? null : grips[nearest];
    };

    let drag: Drag | null = null;

    const handleDownEvent = (event: MapBrowserEvent): boolean => {
      const extent = extentNow();
      if (!extent) return false;
      const grip = gripUnder(event);
      if (grip) {
        drag = { kind: 'resize', grip, start: extent };
        return true;
      }
      const here = toMetric(event.coordinate);
      if (!containsXY(extent, here[0], here[1])) return false;
      drag = { kind: 'move', from: here, start: extent };
      return true;
    };

    const clampSide = (metres: number) =>
      Math.min(Math.max(metres, MIN_SIDE_M), maxSideM);

    const spanned = (
      low: number,
      high: number,
      grip: number,
      to: number,
      side: number | null,
    ): [number, number] => {
      if (grip === 0) return [low, high];
      const anchor = grip < 0 ? high : low;
      const other = anchor + grip * (side ?? clampSide(Math.abs(to - anchor)));
      return [Math.min(anchor, other), Math.max(anchor, other)];
    };

    const handleDragEvent = (event: MapBrowserEvent) => {
      if (!drag) return;
      const here = toMetric(event.coordinate);
      const [minX, minY, maxX, maxY] = drag.start;
      let next: Metric;
      if (drag.kind === 'move') {
        const dx = here[0] - drag.from[0];
        const dy = here[1] - drag.from[1];
        next = [minX + dx, minY + dy, maxX + dx, maxY + dy];
      } else {
        const { x, y } = drag.grip;
        const side = square
          ? clampSide(
              Math.max(
                Math.abs(here[0] - (x < 0 ? maxX : minX)),
                Math.abs(here[1] - (y < 0 ? maxY : minY)),
              ),
            )
          : null;
        const [nextMinX, nextMaxX] = spanned(minX, maxX, x, here[0], side);
        const [nextMinY, nextMaxY] = spanned(minY, maxY, y, here[1], side);
        next = [nextMinX, nextMinY, nextMaxX, nextMaxY];
      }
      store.set(rectAtom, bboxFromMetric(snap ? snap(next) : next));
    };

    const handleUpEvent = (): boolean => {
      drag = null;
      return false;
    };

    const handleMoveEvent = (event: MapBrowserEvent) => {
      const grip = gripUnder(event);
      const extent = extentNow();
      const here = toMetric(event.coordinate);
      cursor.set(
        grip
          ? cursorFor(grip)
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
    const unsubscribe = store.sub(rectAtom, redraw);

    return () => {
      unsubscribe();
      map.removeInteraction(interaction);
      map.removeLayer(layer);
      source.dispose();
      cursor.release();
    };
  }, [map, adjusting, store, rectAtom, layerId, maxSideM, snap, tiles, square]);
};
