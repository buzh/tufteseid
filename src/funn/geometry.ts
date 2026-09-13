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

/*
 * The pen, read as geometry — docs/ui-architecture.md §9.2.
 *
 * A funn *is* geometry: `finds.geometry` is a GeoJSON FeatureCollection in
 * EPSG:4326 and that has not changed. What changed is who holds the pen. The
 * drawing surface is Excalidraw, whose document is a list of elements in scene
 * units, so committing a funn is one conversion — elements to features, scene
 * units to the ground, through the frame the session froze (`frame.ts`).
 *
 * Three things the conversion deliberately loses, each for the same reason:
 * a funn is a *place*, and everything else about how it was drawn is a
 * property of the sketch it was drawn in.
 *
 * - **Style does not survive.** Colour, stroke width, fill, roughness: the
 *   funn layer renders every feature in one cased orange (`funnLayer.ts`), so
 *   a record that carried its own colours would be describing a rendering
 *   nobody performs. An expressive drawing is a sketch (§9.3) and keeps all of
 *   it.
 * - **Text does not convert.** A label has no extent on the ground — it has a
 *   position and a font size in screen pixels, which is a different kind of
 *   thing from a line around a mound. A funn's words are its title and its
 *   note. Text drawn in funn mode is left in the scene and simply is not part
 *   of the geometry.
 * - **Curves are sampled.** An ellipse comes out as a 64-gon and a rounded
 *   rectangle as its corners, the same approximation the OpenLayers pen made
 *   for a Circle before it, and for the same reason: GeoJSON has polygons and
 *   linestrings, and nothing else.
 */

/** Ellipse → polygon. 64 is what a Circle was worth before this. */
const ELLIPSE_SEGMENTS = 64;

type Point = [number, number];

/** Scene-space corners of an element, before rotation. */
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
    .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [el.x + p[0], el.y + p[1]] as Point);
};

/*
 * Rotation is about the element's centre, which is how Excalidraw stores it:
 * `angle` is radians clockwise on a y-down canvas, and the geometry underneath
 * is always the unrotated one.
 */
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

/** Every point an element contributes, in scene units, rotation applied. */
const scenePointsOf = (
  el: SceneElement,
): { points: Point[]; closed: boolean } | null => {
  switch (el.type) {
    case 'rectangle':
    case 'image':
    case 'embeddable':
    case 'iframe':
      // The three non-drawings among them cannot occur — the image tool is off
      // and there is no embed UI — but a rectangle is a rectangle either way,
      // and a switch that lists them is one that does not fall through to a
      // silent `null` if one ever does.
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
      // Excalidraw closes a line by bringing its last point back to its first;
      // a ring is a polygon and an open run is a linestring.
      const [fx, fy] = points[0];
      const [lx, ly] = points[points.length - 1];
      const closed =
        el.type !== 'arrow' &&
        points.length > 3 &&
        Math.hypot(lx - fx, ly - fy) < 1;
      return { points, closed };
    }
    default:
      // text, frame, magicframe, selection — see the module comment.
      return null;
  }
};

/**
 * The drawing's own extent in scene units, or null if it has no geometry.
 *
 * Computed here rather than from Excalidraw's `getCommonBounds` on purpose:
 * this runs on every pointer sample behind the autosave, and it must not be
 * the thing that pulls the editor into a module graph that only wanted to know
 * whether the pen had left the rectangle. `render.ts` uses Excalidraw's own
 * bounds, where being pixel-exact is the whole requirement.
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
 * Elements → a funn's geometry, EPSG:4326.
 *
 * Null when the scene holds nothing convertible, which is a real state rather
 * than a failure: a scene of nothing but text is a scene with no funn in it,
 * and the autosave's "an empty scene is never a delete" rule (§8.5) is what
 * keeps that from clearing the record.
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
      // A GeoJSON ring is explicitly closed; Excalidraw's is not, or is only
      // closed to within a pixel.
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

/*
 * …and back, for `Rediger tegningen`.
 *
 * The strokes that made a funn are not kept — the record is the geometry, and
 * that was the decision (§9.2). So editing one opens the *geometry* in the
 * surface, as plain lines: every ring and every run becomes one Excalidraw
 * line element, and the author nudges its vertices or draws over it exactly as
 * if they had just traced it. Committing converts back, and for a polygon or a
 * linestring that round trip is lossless — the 64-gon an ellipse became stays
 * a 64-gon rather than turning into an ellipse again, which is the honest
 * outcome: the stored record never knew it had been a circle.
 *
 * The elements are skeletons. `restore()` fills in stroke, roughness, seed and
 * the rest of the twenty fields from Excalidraw's defaults, which is exactly
 * what `FunnCanvas` hands `initialData` to, so writing them out here would be
 * asserting defaults that may move under a patch release.
 */
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
    // A linear element's points are relative to its own origin, and the first
    // is the origin: Excalidraw's invariant, not a convention.
    points: points.map(([x, y]) => [x - minX, y - minY]),
  } as unknown as SceneElement;
};

/**
 * Every position in a FeatureCollection, so the two callers that have to place
 * one on the map can walk it once each rather than reimplement the recursion.
 */
const positionsOf = function* (geometry: FeatureCollection): Generator<Position> {
  for (const feature of geometry.features ?? []) {
    const g = feature.geometry;
    if (!g || g.type === 'GeometryCollection') continue;
    // Every remaining GeoJSON geometry is a Position nested zero to three
    // deep, and the depth is the only thing that differs.
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
 * A funn's rectangle, EPSG:4326 — what `FunnSurface` fits the view to before
 * freezing it, so editing a funn does not start on a frame the funn is off.
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
        : (transform(
            [pos[0], pos[1]],
            'EPSG:4326',
            frame.projection,
          ) as [number, number]);
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
        // Holes as their own outlines. A ring is a ring to the pen, and the
        // alternative — dropping them — would silently edit the shape.
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

/**
 * The drawing's extent in the same coordinates as `locality.bbox` — what
 * grow-to-fit reads to answer whether the pen has left the rectangle.
 */
export const geometryExtent4326 = (
  frame: FunnFrame,
  elements: readonly SceneElement[],
): LocalityBbox | null => {
  const scene = sceneGeometryExtent(elements);
  return scene ? sceneExtentToBbox4326(frame, scene) : null;
};
