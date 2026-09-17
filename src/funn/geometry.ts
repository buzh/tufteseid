import type { Feature, FeatureCollection, Position } from 'geojson';
import { transform } from 'ol/proj';
import type { LocalityBbox } from '../api/localities';
import {
  coordToScene,
  sceneExtentToBbox4326,
  sceneToCoord,
  type FunnFrame,
} from './frame';
import type { SceneElement } from './scene';

// Excalidraw elements in scene units → `finds.geometry`, a GeoJSON
// FeatureCollection in EPSG:4326, through the frame the session froze
// (`frame.ts`). The conversion loses three things: style, since `funnLayer.ts`
// renders every feature in one cased orange; text, which has no extent on the
// ground; and curvature, since GeoJSON has polygons and linestrings and nothing
// else, so an ellipse is sampled into a 64-gon on the way in and stays one.
// Background: docs/ui-architecture.md, "Drawing".

const ELLIPSE_SEGMENTS = 64;

type Point = [number, number];

// Scene space, before rotation.
const boxCorners = (el: SceneElement): Point[] => [
  [el.x, el.y],
  [el.x + el.width, el.y],
  [el.x + el.width, el.y + el.height],
  [el.x, el.y + el.height],
];

const diamondCorners = (el: SceneElement): Point[] => [
  [el.x + el.width / 2, el.y],
  [el.x + el.width, el.y + el.height / 2],
  [el.x + el.width / 2, el.y + el.height],
  [el.x, el.y + el.height / 2],
];

const ellipsePoints = (el: SceneElement): Point[] => {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const rx = el.width / 2;
  const ry = el.height / 2;
  const out: Point[] = [];
  for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
    const a = (i / ELLIPSE_SEGMENTS) * 2 * Math.PI;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
};

/** A linear element's points are relative to its own origin. */
const linearPoints = (el: SceneElement): Point[] => {
  const pts = (el as { points?: readonly (readonly number[])[] }).points;
  if (!Array.isArray(pts)) return [];
  return pts
    .filter(
      (p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]),
    )
    .map((p) => [el.x + p[0], el.y + p[1]] as Point);
};

// Excalidraw's `angle` is radians clockwise about the element's centre on a
// y-down canvas, and the stored geometry underneath is always the unrotated one.
const rotateAbout = (points: Point[], el: SceneElement): Point[] => {
  if (!el.angle) return points;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const cos = Math.cos(el.angle);
  const sin = Math.sin(el.angle);
  return points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as Point;
  });
};

/** Scene units, rotation applied. */
const scenePointsOf = (
  el: SceneElement,
): { points: Point[]; closed: boolean } | null => {
  switch (el.type) {
    case 'rectangle':
    case 'image':
    case 'embeddable':
    case 'iframe':
      // Image and the two embeds cannot occur today; listed so they do not fall
      // through to a silent `null` if one ever does.
      return { points: rotateAbout(boxCorners(el), el), closed: true };
    case 'diamond':
      return { points: rotateAbout(diamondCorners(el), el), closed: true };
    case 'ellipse':
      return { points: rotateAbout(ellipsePoints(el), el), closed: true };
    case 'line':
    case 'arrow':
    case 'freedraw': {
      const points = rotateAbout(linearPoints(el), el);
      if (points.length < 2) return null;
      // Excalidraw closes a line by bringing its last point back to its first.
      const [fx, fy] = points[0];
      const [lx, ly] = points[points.length - 1];
      const closed =
        el.type !== 'arrow' &&
        points.length > 3 &&
        Math.hypot(lx - fx, ly - fy) < 1;
      return { points, closed };
    }
    default:
      // text, frame, magicframe, selection: no geometry.
      return null;
  }
};

/**
 * Scene units; null if the drawing has no geometry. Not Excalidraw's
 * `getCommonBounds`: this runs on every pointer sample and must not pull the
 * editor bundle into the graph. `render.ts`, which has to be pixel-exact, does.
 */
export const sceneGeometryExtent = (
  elements: readonly SceneElement[],
): [number, number, number, number] | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    if (el.isDeleted) continue;
    const shape = scenePointsOf(el);
    if (!shape) continue;
    for (const [x, y] of shape.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
};

/**
 * Elements → a funn's geometry, EPSG:4326. Null when the scene holds nothing
 * convertible — a real state, which the autosave reads as "no write" rather
 * than as a delete.
 */
export const sceneToGeometry = (
  frame: FunnFrame,
  elements: readonly SceneElement[],
): FeatureCollection | null => {
  const features: Feature[] = [];
  const toLonLat = (p: Point): Position => {
    const ground = sceneToCoord(frame, p[0], p[1]);
    return frame.projection === 'EPSG:4326'
      ? [ground[0], ground[1]]
      : (transform(ground, frame.projection, 'EPSG:4326') as Position);
  };

  for (const el of elements) {
    if (el.isDeleted) continue;
    const shape = scenePointsOf(el);
    if (!shape) continue;
    const ring = shape.points.map(toLonLat);
    if (shape.closed) {
      // A GeoJSON ring is explicitly closed; Excalidraw's is only closed to
      // within a pixel.
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
      if (ring.length < 4) continue;
      features.push({
        type: 'Feature',
        id: el.id,
        properties: {},
        geometry: { type: 'Polygon', coordinates: [ring] },
      });
    } else {
      features.push({
        type: 'Feature',
        id: el.id,
        properties: {},
        geometry: { type: 'LineString', coordinates: ring },
      });
    }
  }

  if (features.length === 0) return null;
  return { type: 'FeatureCollection', features };
};

// …and back, for `Rediger tegningen`: the strokes are not kept, so editing a
// funn opens its geometry as plain lines, one per ring or run. The elements are
// skeletons — `restore()` fills stroke, roughness, seed and the rest from
// Excalidraw's defaults, and writing them out here would pin defaults that move
// under a patch release.
let sceneElementCounter = 0;

const lineElement = (points: Point[]): SceneElement | null => {
  if (points.length < 2) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    id: `funn-${(sceneElementCounter++).toString(36)}`,
    type: 'line',
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
    angle: 0,
    // Excalidraw's invariant: a linear element's points are relative to its own
    // origin, and the first point is that origin.
    points: points.map(([x, y]) => [x - minX, y - minY]),
  } as unknown as SceneElement;
};

/** Every position in a FeatureCollection, whatever its geometry types. */
const positionsOf = function* (
  geometry: FeatureCollection,
): Generator<Position> {
  for (const feature of geometry.features ?? []) {
    const g = feature.geometry;
    if (!g || g.type === 'GeometryCollection') continue;
    // Every remaining GeoJSON geometry is a Position nested zero to three deep.
    const flatten = function* (node: unknown): Generator<Position> {
      if (!Array.isArray(node)) return;
      if (typeof node[0] === 'number') {
        yield node as Position;
        return;
      }
      for (const child of node) yield* flatten(child);
    };
    yield* flatten(g.coordinates);
  }
};

/**
 * A funn's rectangle, EPSG:4326. `FunnSurface` fits the view to it before
 * freezing, so editing does not start on a frame the funn is off.
 */
export const geometryBbox4326 = (
  geometry: FeatureCollection,
): LocalityBbox | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of positionsOf(geometry)) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
};

/** A funn's stored geometry → something the surface can open. */
export const geometryToScene = (
  frame: FunnFrame,
  geometry: FeatureCollection,
): SceneElement[] => {
  const toScene = (pos: Position): Point => {
    const ground =
      frame.projection === 'EPSG:4326'
        ? ([pos[0], pos[1]] as [number, number])
        : (transform([pos[0], pos[1]], 'EPSG:4326', frame.projection) as [
            number,
            number,
          ]);
    return coordToScene(frame, ground);
  };

  const out: SceneElement[] = [];
  const add = (coords: Position[]) => {
    const el = lineElement(coords.map(toScene));
    if (el) out.push(el);
  };
  for (const feature of geometry.features ?? []) {
    const g = feature.geometry;
    if (!g) continue;
    switch (g.type) {
      case 'Polygon':
        // Holes become their own outlines; dropping them would silently edit
        // the shape.
        for (const ring of g.coordinates) add(ring);
        break;
      case 'MultiPolygon':
        for (const polygon of g.coordinates) {
          for (const ring of polygon) add(ring);
        }
        break;
      case 'LineString':
        add(g.coordinates);
        break;
      case 'MultiLineString':
        for (const line of g.coordinates) add(line);
        break;
      default:
        // Points and collections: nothing this app has ever written.
        break;
    }
  }
  return out;
};

/** Same coordinates as `locality.bbox`, which is what grow-to-fit compares to. */
export const geometryExtent4326 = (
  frame: FunnFrame,
  elements: readonly SceneElement[],
): LocalityBbox | null => {
  const scene = sceneGeometryExtent(elements);
  return scene ? sceneExtentToBbox4326(frame, scene) : null;
};
