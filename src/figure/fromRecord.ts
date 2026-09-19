// A stored record → the legend that gets stamped on it. Nothing on disk
// carries a plate, so this is the only description of a figure the app has,
// and it is rebuilt from `meta` every time a file goes out — in the reader's
// language, and in the current wording rather than whatever was true when the
// pin ran.
//
// Re-checks every field, like `viewSpecOf` and for the same reason: `meta` is
// free-form JSON from six producers over several schema revisions. `null`
// means "no legend", which is a real answer rather than a failure — an
// upload's provenance is not the app's to state, and a record too old to
// describe itself gets bare pixels rather than a caption that might be wrong.

import { t } from 'i18next';
import type { AttachmentKind, AttachmentMeta } from '../api/attachments';
import { creditOf, type LocalityRecord } from '../api/localities';
import { viewSpecOf } from '../localities/viewSpec';
import type { BackgroundLayerName } from '../map/layers/backgroundLayers';
import {
  HERITAGE_DETAILS,
  HERITAGE_RENDERS,
  type HeritageDetail,
  type HeritageRender,
} from '../map/layers/heritage';
import type { FigureSpec } from './figure';
import {
  describeHeritageRender,
  flyfotoFigure,
  lidarExtractFigure,
  SCENE_LAYER_CREDITS,
  sceneFigure,
  type SceneFigureLayer,
  type SceneLayerCredit,
  screenshotFigure,
  sketchFigure,
  terrainFigure,
} from './specs';

const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const bboxOf = (v: unknown): [number, number, number, number] | null => {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const out = v.map(num);
  return out.every((n): n is number => n != null)
    ? (out as [number, number, number, number])
    : null;
};

// ---------------------------------------------------------------------------
// Who the picture is by
// ---------------------------------------------------------------------------

/**
 * The name that goes on the authored half of the rights line. The lokalitet's
 * owner, not the reader and not whoever pressed download: the funn, the light
 * and the arrangement are theirs, and a takeout handed to a third party must
 * still say so.
 */
export const authorOf = (loc: LocalityRecord): string =>
  creditOf(loc) ?? t('localities.takeout.ownerUnknown');

export type StampContext = {
  /** The lokalitet's name, in front of the product on the title line. */
  subject?: string;
  author: string;
  /** i18next's current language — the theme layers name themselves in it. */
  language: string;
};

export const stampContextOf = (
  loc: LocalityRecord,
  language: string,
): StampContext => ({
  subject: loc.name || undefined,
  author: authorOf(loc),
  language,
});

// ---------------------------------------------------------------------------
// Screenshot: what was on the map, as the record remembers it
// ---------------------------------------------------------------------------

/** What the ground was, for the screenshot legend's source line. */
const GROUND_LABEL_KEY: Record<BackgroundLayerName, string> = {
  // The five Kart cartographies name themselves rather than all reporting
  // "Kart"; the legend is the only place the file says which it is.
  topo: 'ribbon.kart.topo',
  topograatone: 'ribbon.kart.topograatone',
  toporaster: 'ribbon.kart.toporaster',
  sjokartraster: 'ribbon.kart.sjokartraster',
  amtskart: 'ribbon.kart.amtskart',
  empty: 'ribbon.mode.kart',
  lidarHillshade: 'ribbon.mode.lidar',
  lidarProject: 'ribbon.mode.lidar',
  // Named rather than folded into LiDAR: the pixels are a derived product
  // computed here, and the legend is the only place the file says so.
  lidarCvat: 'ribbon.lidar.cvat',
  flyfoto: 'ribbon.mode.flyfoto',
  flyfotoProject: 'ribbon.mode.flyfoto',
  // Never the value of the background atom (hybrid is a modifier), but the
  // union has to be covered.
  topoOverlay: 'ribbon.mode.hybrid',
};

const backgroundOf = (v: unknown): BackgroundLayerName | null => {
  const s = str(v);
  // Own keys only, and not `Object.hasOwn`: the app compiles against ES2020.
  // `s in …` would take `toString` off the prototype and hand `t()` a function.
  return s && Object.prototype.hasOwnProperty.call(GROUND_LABEL_KEY, s)
    ? (s as BackgroundLayerName)
    : null;
};

// Hybrid is a LiDAR stack with names on it: same credit, different label.
const groundLabel = (layer: BackgroundLayerName | null, hybrid: boolean) =>
  t(hybrid ? 'ribbon.mode.hybrid' : (GROUND_LABEL_KEY[layer ?? 'empty'] ?? ''));

// Grounds whose credit line has to name NiB as well as Kartverket.
const NIB_GROUNDS = new Set<BackgroundLayerName>(['flyfoto', 'flyfotoProject']);

/**
 * The heritage overlay's settings, re-read. Absent, malformed or at its
 * defaults all come back undefined, which is the same thing on the plate.
 */
const heritageLine = (v: unknown): string | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const h = v as Record<string, unknown>;
  const render = str(h.render);
  if (!render || !(HERITAGE_RENDERS as readonly string[]).includes(render)) {
    return undefined;
  }
  const raw = Array.isArray(h.details) ? h.details : [];
  const details = new Set(
    HERITAGE_DETAILS.filter((d) => (raw as unknown[]).includes(d)),
  ) as ReadonlySet<HeritageDetail>;
  return describeHeritageRender(
    details,
    render as HeritageRender,
    num(h.opacity) ?? 1,
  );
};

const screenshotSpec = (
  meta: Record<string, unknown>,
  metresPerPx: number,
  bbox25833: [number, number, number, number],
  ctx: StampContext,
): FigureSpec => {
  const layer = backgroundOf(meta.ground);
  const hybrid = meta.hybrid === true;
  const compare = (meta.compare ?? null) as Record<string, unknown> | null;
  const layerB = compare ? backgroundOf(compare.ground) : null;
  const themeLayers = (Array.isArray(meta.themeLayers) ? meta.themeLayers : [])
    .map(str)
    .filter((s): s is string => s != null);
  return screenshotFigure({
    subject: ctx.subject,
    author: ctx.author,
    groundLabel: compare
      ? t('figure.source.compareGrounds', {
          left: groundLabel(layer, hybrid),
          right: groundLabel(layerB, compare.hybrid === true),
        })
      : groundLabel(layer, hybrid),
    groundIsFlyfoto:
      (layer != null && NIB_GROUNDS.has(layer)) ||
      (layerB != null && NIB_GROUNDS.has(layerB)),
    themeLayers,
    // Missing on records written before the field existed, and false is the
    // safe reading: it credits nobody the pixels do not owe.
    composed: meta.composed === true,
    heritageRender: heritageLine(meta.heritage),
    metresPerPx,
    bbox25833,
    rotation: num(meta.rotation) ?? 0,
    language: ctx.language,
  });
};

// ---------------------------------------------------------------------------
// Scene: the stack as it actually landed
// ---------------------------------------------------------------------------

/**
 * The flatten's own record of what went into it, written by the pin. Not
 * `meta.layers`: that is the arrangement as asked for, and a member deleted
 * between the ask and the render is in the one and not in the pixels. Labels
 * are the members' captions and so are stored verbatim; the credit is an enum,
 * so the line it turns into is still translated at stamp time.
 */
const stackOf = (
  v: unknown,
): { ground?: SceneFigureLayer; layers: SceneFigureLayer[] } | null => {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;

  const layerOf = (entry: unknown, withOpacity: boolean) => {
    if (!entry || typeof entry !== 'object') return null;
    const e = entry as Record<string, unknown>;
    const credit = str(e.credit);
    const label = str(e.label);
    if (!label || !credit) return null;
    return {
      label,
      credit: ((SCENE_LAYER_CREDITS as readonly string[]).includes(credit)
        ? credit
        : 'none') as SceneLayerCredit,
      ...(withOpacity ? { opacity: num(e.opacity) ?? 100 } : {}),
    };
  };

  const ground = layerOf(s.ground, false);
  const layers = (Array.isArray(s.layers) ? s.layers : []).flatMap((entry) => {
    const layer = layerOf(entry, true);
    return layer ? [layer] : [];
  });
  if (!ground && layers.length === 0) return null;
  return { ...(ground ? { ground } : {}), layers };
};

// ---------------------------------------------------------------------------

/**
 * The map's own rectangle inside the stored file, for the records pinned while
 * the caption panel was still burned in below it. Nothing writes `imageRect`
 * any more, so a missing one is the normal case and means the file is all map.
 */
const cropOf = (meta: Record<string, unknown>): FigureSpec['crop'] => {
  const r = meta.imageRect as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return undefined;
  const x = num(r.x);
  const y = num(r.y);
  const width = num(r.width);
  const height = num(r.height);
  return x != null && y != null && width != null && height != null
    ? { x, y, width, height }
    : undefined;
};

// The legend itself. Everything that reads `meta` for the plate's *text* is
// below; the crop is bolted on by the caller, because it describes the file
// rather than the figure.
const describe = (
  rec: { kind: AttachmentKind; meta: AttachmentMeta | null },
  ctx: StampContext,
): FigureSpec | null => {
  const meta = rec.meta as Record<string, unknown> | null;
  if (!meta) return null;
  const metresPerPx = num(meta.metresPerPx);
  const bbox25833 = bboxOf(meta.bbox25833);
  if (metresPerPx == null || metresPerPx <= 0 || !bbox25833) return null;

  // Somebody else's file, passed through untouched. The app knows neither what
  // it is a picture of nor who may copy it, and inventing either is the one
  // thing this module exists to prevent.
  if (rec.kind === 'upload') return null;

  const common = {
    subject: ctx.subject,
    // A `Ta med` copy carries somebody else's composition; crediting whoever
    // borrowed it would be the one thing the authored half must never say.
    author: str(meta.takenFromAuthor) ?? ctx.author,
  };

  if (rec.kind === 'screenshot') {
    return screenshotSpec(meta, metresPerPx, bbox25833, {
      ...ctx,
      author: common.author,
    });
  }

  if (rec.kind === 'scene') {
    const stack = stackOf(meta.stack);
    // Pinned before the flatten recorded its own stack: the arrangement is
    // unknowable now, so the pixels go out bare.
    if (!stack) return null;
    return sceneFigure({ ...common, ...stack, metresPerPx, bbox25833 });
  }

  const view = viewSpecOf(rec);
  if (!view) return null;

  switch (view.kind) {
    case 'lidar':
      return lidarExtractFigure({
        ...common,
        sourceLabel:
          str(meta.sourceLabel) ??
          (view.source === 'national'
            ? t('ribbon.lidar.nationalMosaic')
            : view.source.projectName),
        style: view.style,
        year: num(meta.year),
        pointDensity: str(meta.pointDensity),
        metresPerPx,
        bbox25833,
      });

    case 'terrain':
      return terrainFigure({
        ...common,
        vis: view.vis,
        model: view.model,
        light: {
          azimuth: view.azimuth,
          altitude: view.altitude,
          zFactor: view.zFactor,
        },
        metresPerPx,
        nativeMetresPerPx: num(meta.nativeMetresPerPx) ?? undefined,
        bbox25833,
        ...(view.radius != null ? { radius: view.radius } : {}),
      });

    case 'flyfoto':
      return flyfotoFigure({
        ...common,
        ...(view.source === 'mosaic'
          ? {}
          : {
              project: {
                projectName:
                  str(meta.projectName) ?? str(meta.projectId) ?? '—',
                year: num(meta.year),
                photoDate: str(meta.photoDate),
                metresPerPx: num(meta.projectMetresPerPx),
              },
            }),
        metresPerPx,
        bbox25833,
      });

    case 'sketch':
      return sketchFigure({
        ...common,
        elements: view.scene.elements.length,
        metresPerPx,
        bbox25833,
      });

    // Handled above, off the stack rather than off the membership.
    case 'scene':
      return null;
  }
};

/**
 * The legend for one stored attachment, or null where there is none to state.
 * The extent and the resolution are required rather than defaulted: a plate
 * whose scale bar is a guess is worse than no plate.
 *
 * Takes the two columns rather than the record, like `viewSpecOf`: a picker
 * proposal is a kind and a `meta` with no row behind it yet, and it still has
 * to download with the same plate the kept one would carry.
 */
export const figureSpecOf = (
  rec: { kind: AttachmentKind; meta: AttachmentMeta | null },
  ctx: StampContext,
): FigureSpec | null => {
  const spec = describe(rec, ctx);
  if (!spec) return null;
  const crop = cropOf((rec.meta ?? {}) as Record<string, unknown>);
  return crop ? { ...spec, crop } : spec;
};
