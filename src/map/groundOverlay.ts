// The georeferenced images over the background: declared members composited
// bottom-to-top into one layer, each with its own opacity. Producers declare a
// key; `setGroundOverlayStack` supplies the order per group, and a key nobody
// ordered paints on top. Module-level and imperative — pixels and opacity
// change dozens of times a second, so neither goes through React.

import { atom, getDefaultStore } from 'jotai';
import type { Extent } from 'ol/extent';
import ImageLayer from 'ol/layer/Image';
import type { Size } from 'ol/size';
import ImageCanvasSource from 'ol/source/ImageCanvas';
import { mapAtom } from './atoms';

const LAYER_ID = 'ground.overlay';

// Over the background (no zIndex, i.e. 0) and under the compare curtain (1.5),
// the sketches (2), the lokalitet rectangles (4), the funn (5), the themes (10).
const Z_INDEX = 1;

/** The live terrain render's key, declared by `useTerrainAnalysis`. */
export const TERRAIN_KEY = 'terrain';

export const viewKeyOf = (attachmentId: string) => `view:${attachmentId}`;

export const bildeKeyOf = (attachmentId: string) => `bilde:${attachmentId}`;

/** The two layer-row groups that paint into this one layer, bottom to top. */
export type GroundGroup = 'visning' | 'bilde';

const GROUP_ORDER: readonly GroundGroup[] = ['visning', 'bilde'];

export type GroundOverlayMember = {
  /** Terrain hands over the same canvas it paints into, so `setGroundOverlay`
   * is also the repaint call. */
  source: HTMLCanvasElement | HTMLImageElement;
  /** The part of `source` that is ground, in its own pixels. The whole image,
   * except on a bilde pinned back when the file carried a caption panel — see
   * `cropOf`. */
  crop: { x: number; y: number; width: number; height: number };
  /** EPSG:25833. The ground `crop` covers, edge to edge. */
  extent25833: [number, number, number, number];
};

let layer: ImageLayer<ImageCanvasSource> | null = null;

const members = new Map<string, GroundOverlayMember>();

// Never pruned: a fade must outlive its member, since switching DTM→DOM
// withdraws the terrain image and declares a new one under the same key.
const opacityByKey = new Map<string, number>();

// Per group: its members bottom to top, and which it is holding down. Held is
// not withdrawn — it is skipped in the draw loop and nothing else moves.
const groups = new Map<
  GroundGroup,
  { keys: readonly string[]; held: ReadonlySet<string> }
>();

let held: ReadonlySet<string> = new Set<string>();

const stack = (): string[] => {
  const named: string[] = [];
  for (const group of GROUP_ORDER) {
    for (const key of groups.get(group)?.keys ?? []) {
      if (members.has(key)) named.push(key);
    }
  }
  const rest = [...members.keys()].filter((key) => !named.includes(key));
  return [...named, ...rest];
};

// One layer and one canvas for the whole group, reused: the output canvas is
// viewport-sized (~30 MB), and a slider drag would reallocate it every frame.
let out: HTMLCanvasElement | null = null;

const drawFrame = (
  extent: Extent,
  resolution: number,
  pixelRatio: number,
  size: Size,
): HTMLCanvasElement => {
  out ??= document.createElement('canvas');
  const width = Math.round(size[0]);
  const height = Math.round(size[1]);
  if (out.width !== width || out.height !== height) {
    out.width = width;
    out.height = height;
  }
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  ctx.clearRect(0, 0, width, height);

  const scale = pixelRatio / resolution;
  for (const key of stack()) {
    if (held.has(key)) continue;
    const member = members.get(key);
    if (!member) continue;
    const alpha = opacityByKey.get(key) ?? 1;
    if (!(alpha > 0)) continue;
    const [minX, minY, maxX, maxY] = member.extent25833;
    const w = (maxX - minX) * scale;
    const h = (maxY - minY) * scale;
    const { x, y, width: cw, height: ch } = member.crop;
    if (cw <= 0 || ch <= 0) continue;
    ctx.globalAlpha = alpha;
    // Nearest-neighbour on upscale — smoothing blurs away the single-pixel
    // step the image exists to show — and averaging on downscale.
    ctx.imageSmoothingEnabled = w < cw;
    ctx.drawImage(
      member.source,
      x,
      y,
      cw,
      ch,
      (minX - extent[0]) * scale,
      (extent[3] - maxY) * scale,
      w,
      h,
    );
  }
  ctx.globalAlpha = 1;
  return out;
};

const redraw = () => {
  const map = getDefaultStore().get(mapAtom);
  if (members.size === 0) {
    if (layer) map.removeLayer(layer);
    layer = null;
    out = null;
    return;
  }
  if (!layer) {
    layer = new ImageLayer({
      source: new ImageCanvasSource({
        // Fixed, so a view in another projection reprojects.
        projection: 'EPSG:25833',
        canvasFunction: drawFrame,
      }),
      zIndex: Z_INDEX,
      properties: { id: LAYER_ID },
    });
    map.addLayer(layer);
    return;
  }
  layer.getSource()?.changed();
};

/** Put this member up, move it, announce that its pixels changed, or — with
 * `null` — take it down: the source caches one image, and `changed()` is the
 * only way to invalidate it. */
export const setGroundOverlay = (
  key: string,
  member: GroundOverlayMember | null,
) => {
  if (member) members.set(key, member);
  else if (!members.delete(key)) return;
  redraw();
};

export const setGroundOverlayOpacity = (key: string, value: number) => {
  if (opacityByKey.get(key) === value) return;
  opacityByKey.set(key, value);
  if (members.has(key)) redraw();
};

const sameOrder = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((key, i) => key === b[i]);

const sameHeld = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((key) => b.has(key));

/** One group's members bottom to top, and which of them it is holding down.
 * One caller per group, re-declaring the whole list every time. */
export const setGroundOverlayStack = (
  group: GroundGroup,
  keys: readonly string[],
  hidden: ReadonlySet<string>,
) => {
  const cur = groups.get(group);
  if (cur && sameOrder(cur.keys, keys) && sameHeld(cur.held, hidden)) return;
  groups.set(group, { keys, held: hidden });

  const union = new Set<string>();
  for (const g of groups.values()) for (const key of g.held) union.add(key);
  held = union;

  redraw();
};

// The two groups' control state. Not persisted; `useLocalityWorkspace` clears
// it all when the lokalitet closes or swaps.

/** Which View is on the ground, by attachment id. A set, though every writer
 * keeps it to at most one, and seeded with at most the cover on open: an
 * unpinned View can start a WMS stitch. */
export const visningShownAtom = atom<ReadonlySet<string>>(new Set<string>());

/** The cover the workspace laid down: the first ground selection withdraws it,
 * since a ground button that repaints only what is under it looks broken. */
export const provisionalViewAtom = atom<string | null>(null);

/** Spend the latch — one atom rather than two setters, since withdrawing
 * without clearing would re-arm it on the next ground change. */
export const spendProvisionalViewAtom = atom(
  null,
  (get, set, how: 'withdraw' | 'keep') => {
    const id = get(provisionalViewAtom);
    if (id == null) return;
    set(provisionalViewAtom, null);
    if (how === 'keep') return;
    const shown = get(visningShownAtom);
    if (!shown.has(id)) return;
    const next = new Set(shown);
    next.delete(id);
    set(visningShownAtom, next);
  },
);

export const visningOpacityAtom = atom<ReadonlyMap<string, number>>(
  new Map<string, number>(),
);

export const visningGroupShownAtom = atom(true);

export const bildeShownAtom = atom<ReadonlySet<string>>(new Set<string>());

export const bildeOpacityAtom = atom<ReadonlyMap<string, number>>(
  new Map<string, number>(),
);

export const bildeGroupShownAtom = atom(true);
