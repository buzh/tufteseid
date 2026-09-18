// One spec builder per producer of a raster, kept together rather than beside
// each producer so the wording and the credit assignment stay the same across
// all of them. `settings` is the reproducibility contract: enough for somebody
// else to ask the same service for the same picture. Hence the raw WMS style
// name verbatim, the multidirectional blend's azimuths *and* weights, and a
// percentile stretch named as one — a slope map stretched 2–98 % and one
// stretched to its true range are different pictures of the same ground.
//
// These run at stamp time, from a stored record rather than from the live
// objects a render held, so every input here is something `meta` can carry.
// `fromRecord.ts` is what reads it back.

import { t } from 'i18next';
import {
  HERITAGE_DETAILS,
  type HeritageDetail,
  type HeritageRender,
} from '../map/layers/heritage';
import { lidarStyleLabel } from '../map/layers/config/backgroundLayers/lidarProjects';
import { themeLayerName } from '../map/layers/themeLayerConfigApi';
import type { DemModel } from '../terrain/dem';
import { defaultRadius, usesHorizon, type TerrainLight } from '../terrain/render';
import {
  horizonDecimation,
  MULTI_AZIMUTHS,
  SVF_DIRECTIONS,
  VAT_ALTITUDE,
  VAT_AZIMUTH,
  VAT_LAYERS,
  VAT_Z_FACTOR,
  type Visualization,
} from '../terrain/shade';
import { dec, joinDot } from './draw';
import {
  type AuthoredCredit,
  type Credit,
  CREDITS,
  type FigureSpec,
  type SourceCredit,
} from './figure';

type Bbox25833 = [number, number, number, number];

/**
 * What a dataset is *in this picture*, and what act produced the picture. The
 * first four name pixels somebody else made; the last three name the author's
 * own work, and choosing between `skyggerelieff` and `høydedata` is how a
 * reader tells "Kartverket shaded this" from "we did".
 */
const ROLE = {
  hoydedata: 'figure.role.hoydedata',
  skyggerelieff: 'figure.role.skyggerelieff',
  ortofoto: 'figure.role.ortofoto',
  kart: 'figure.role.kart',
  kulturminner: 'figure.role.kulturminner',
  visualisering: 'figure.role.visualisering',
  tegning: 'figure.role.tegning',
  sammenstilling: 'figure.role.sammenstilling',
} as const;

/** The lokalitet's name in front of the product, when there is one. */
const titleOf = (subject: string | undefined, product: string) =>
  subject ? `${subject} · ${product}` : product;

/** Two rights holders in the same role are one line on the legend. */
const dedupeCredits = (credits: SourceCredit[]): SourceCredit[] => {
  const seen = new Set<string>();
  return credits.filter((c) => {
    const key = `${c.roleKey}|${c.credit.holder}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const source = (roleKey: string, credit: Credit): SourceCredit => ({
  roleKey,
  credit,
});

const authored = (roleKey: string, author: string): AuthoredCredit => ({
  roleKey,
  author,
});

/** Every spec builder takes these two. */
type Common = {
  subject?: string;
  /** The lokalitet owner's display name — see `fromRecord.authorOf`. */
  author: string;
};

// ---------------------------------------------------------------------------
// LiDAR extract — Kartverket's pre-baked relief, stitched from WMS
// ---------------------------------------------------------------------------

export type LidarExtractFigureInput = Common & {
  /** The source's own name: a project name, or the national mosaic. */
  sourceLabel: string;
  /** The WMS style suffix, verbatim — this is what makes it re-requestable. */
  style: string;
  year?: number | null;
  pointDensity?: string | null;
  metresPerPx: number;
  bbox25833: Bbox25833;
};

/**
 * No authored credit, and that is the reading rather than an omission: the WMS
 * hands back an already-shaded image and all the app did was ask for tiles and
 * put them side by side. Whoever chose the style chose it from Kartverket's
 * list.
 */
export const lidarExtractFigure = (
  input: LidarExtractFigureInput,
): FigureSpec => ({
  // The title says what the picture is, the settings row says how to ask for
  // it again: prose here, the raw suffix there.
  title: titleOf(
    input.subject,
    `${t('figure.title.extract')} — ${lidarStyleLabel(input.style)}`,
  ),
  source: joinDot([t('figure.source.lidarWms'), input.sourceLabel]),
  acquisition:
    joinDot([
      input.year ? t('figure.acq.year', { year: input.year }) : null,
      input.pointDensity
        ? t('figure.acq.density', { density: input.pointDensity })
        : null,
    ]) || undefined,
  // The extract tool is DTM-only, so the model is a constant here.
  settings: [
    t('figure.set.wmsStyle', { style: input.style }),
    t('figure.set.model', { model: 'DTM' }),
  ],
  metresPerPx: input.metresPerPx,
  bbox25833: input.bbox25833,
  credits: [source(ROLE.skyggerelieff, CREDITS.hoydedata)],
});

// ---------------------------------------------------------------------------
// Terrenganalyse — relief computed here from the float DEM
// ---------------------------------------------------------------------------

export type TerrainFigureInput = Common & {
  vis: Visualization;
  model: DemModel;
  light: TerrainLight;
  metresPerPx: number;
  /**
   * What the finest acquisition over the rectangle publishes. The grid is
   * capped, so a large rectangle is served coarser than its source; omitted
   * where they are equal or where the record predates the field.
   */
  nativeMetresPerPx?: number;
  bbox25833: Bbox25833;
  /**
   * Metres; `lrm` and the horizon views only, and already through the render's
   * own clamp — `pinQueue` writes back the radius that was used, not the one
   * that was asked for. Omitted means the default.
   */
  radius?: number;
};

/**
 * VAT's layer stack as one line: what was blended over what, at what opacity,
 * stretched between what. Assembled from VAT_LAYERS rather than written out,
 * because a hand-written legend is one edit away from describing a blend the
 * code no longer performs.
 */
const vatStack = (): string =>
  VAT_LAYERS.map((layer) =>
    t('figure.set.vatLayer', {
      vis: t(`localities.terrain.vis.${layer.vis}`),
      blend: t(`figure.blend.${layer.blend}`),
      opacity: layer.opacity,
      min: dec(layer.min, 2),
      max: dec(layer.max, 2),
    }),
  ).join(' + ');

const terrainSettings = ({
  vis,
  light,
  metresPerPx,
  nativeMetresPerPx,
  radius,
}: Pick<
  TerrainFigureInput,
  'vis' | 'light' | 'metresPerPx' | 'nativeMetresPerPx' | 'radius'
>): string[] => {
  const settings: string[] = [];
  const r = radius ?? defaultRadius(vis);
  switch (vis) {
    case 'hillshade':
      settings.push(
        t('figure.set.azimuth', { deg: light.azimuth }),
        t('figure.set.altitude', { deg: light.altitude }),
        t('figure.set.zFactor', { z: light.zFactor }),
      );
      break;
    case 'multiHillshade':
      settings.push(
        t('figure.set.multiAzimuths', {
          azimuths: MULTI_AZIMUTHS.map((a) => a.azimuth).join('/'),
          weights: MULTI_AZIMUTHS.map((a) => a.weight).join('/'),
        }),
        t('figure.set.altitude', { deg: light.altitude }),
        t('figure.set.zFactor', { z: light.zFactor }),
      );
      break;
    case 'slope':
      settings.push(
        t('figure.set.zFactor', { z: light.zFactor }),
        t('figure.set.inverted'),
        t('figure.set.stretch'),
      );
      break;
    case 'lrm':
      settings.push(
        t('figure.set.lrmRadius', { m: r }),
        t('figure.set.diverging'),
        t('figure.set.stretch'),
      );
      break;
    case 'svf':
      settings.push(
        t('figure.set.svfRadius', { m: r }),
        t('figure.set.svfDirections', { n: SVF_DIRECTIONS }),
        t('figure.set.stretch'),
      );
      break;
    // Both opennesses record the same two numbers as sky-view factor, but under
    // their own label, because "SVF-radius" on an openness legend reads as the
    // wrong parameter; negative openness also records its inverted ramp.
    case 'openPos':
      settings.push(
        t('figure.set.opennessRadius', { m: r }),
        t('figure.set.svfDirections', { n: SVF_DIRECTIONS }),
        t('figure.set.stretch'),
      );
      break;
    case 'openNeg':
      settings.push(
        t('figure.set.opennessRadius', { m: r }),
        t('figure.set.svfDirections', { n: SVF_DIRECTIONS }),
        t('figure.set.inverted'),
        t('figure.set.stretch'),
      );
      break;
    // Nothing here is adjustable — frozen sun, 1× exaggeration, fixed stretches
    // — and printing it is how a reader knows the picture was not tuned to
    // flatter this particular ground.
    case 'vat':
      settings.push(
        t('figure.set.vatStack', { stack: vatStack() }),
        t('figure.set.azimuth', { deg: VAT_AZIMUTH }),
        t('figure.set.altitude', { deg: VAT_ALTITUDE }),
        t('figure.set.zFactor', { z: VAT_Z_FACTOR }),
        t('figure.set.opennessRadius', { m: r }),
        t('figure.set.svfDirections', { n: SVF_DIRECTIONS }),
        t('figure.set.absoluteStretch'),
      );
      break;
  }
  // The horizon scan averages the DEM down to reach past its step budget, so
  // these views are read off a coarser surface than the resolution line claims,
  // and the same radius over two surfaces is two different measurements.
  if (usesHorizon(vis)) {
    const factor = horizonDecimation(metresPerPx, r);
    if (factor > 1) {
      settings.push(
        t('figure.set.horizonGrid', { m: dec(metresPerPx * factor, 2) }),
      );
    }
  }
  if (nativeMetresPerPx != null && nativeMetresPerPx < metresPerPx) {
    settings.push(t('figure.set.resampled', { m: dec(nativeMetresPerPx, 2) }));
  }
  return settings;
};

/**
 * The first of the authored kinds. hoydedata.no served height *values*; every
 * visible thing in the picture — the sun, the ramp, the stretch — was decided
 * and computed here, which is why the author and the app are named on it.
 */
export const terrainFigure = (input: TerrainFigureInput): FigureSpec => ({
  title: titleOf(
    input.subject,
    `${t('figure.title.terrain')} — ${t(`localities.terrain.vis.${input.vis}`)}`,
  ),
  source: t('figure.source.dem', { model: input.model.toUpperCase() }),
  settings: terrainSettings(input),
  metresPerPx: input.metresPerPx,
  bbox25833: input.bbox25833,
  credits: [source(ROLE.hoydedata, CREDITS.hoydedata)],
  authored: authored(ROLE.visualisering, input.author),
});

// ---------------------------------------------------------------------------
// Flyfoto — Norge i bilder ortofoto
// ---------------------------------------------------------------------------

/**
 * The acquisition, flattened out of `FlyfotoProject` to the four fields the
 * legend prints — the catalogue is long gone by stamp time, and these are what
 * `flyfotoSpecMeta` put on the record.
 */
export type FlyfotoAcquisition = {
  projectName: string;
  year?: number | null;
  photoDate?: string | null;
  /** The acquisition's native resolution, not the stitch's. */
  metresPerPx?: number | null;
};

export type FlyfotoFigureInput = Common & {
  /** Absent for the seamless best-available mosaic. */
  project?: FlyfotoAcquisition;
  metresPerPx: number;
  bbox25833: Bbox25833;
};

/** Untouched, as `figure.set.ortofoto` says: no authored credit. */
export const flyfotoFigure = ({
  subject,
  project,
  metresPerPx,
  bbox25833,
}: FlyfotoFigureInput): FigureSpec => ({
  title: titleOf(
    subject,
    project?.year
      ? `${t('figure.title.flyfoto')} ${project.year}`
      : t('figure.title.flyfoto'),
  ),
  source: project
    ? t('figure.source.nibProject')
    : t('figure.source.nibMosaic'),
  acquisition: project
    ? joinDot([
        t('figure.acq.project', { name: project.projectName }),
        project.photoDate
          ? t('figure.acq.date', { date: project.photoDate })
          : null,
        project.metresPerPx
          ? t('figure.acq.native', { m: dec(project.metresPerPx, 2) })
          : null,
      ])
    : undefined,
  settings: [t('figure.set.ortofoto')],
  metresPerPx,
  bbox25833,
  credits: [source(ROLE.ortofoto, CREDITS.nib)],
});

// ---------------------------------------------------------------------------
// Skisse — the author's own hand, re-exported
// ---------------------------------------------------------------------------

export type SketchFigureInput = Common & {
  /** How many strokes and shapes the scene holds. */
  elements: number;
  metresPerPx: number;
  bbox25833: Bbox25833;
};

/**
 * The one figure with no source credit at all — nothing in the pixels came
 * from a public register — and therefore the one whose rights line is entirely
 * the authored half. Its extent is the *drawing's* rather than the lokalitet's:
 * the rectangle `funn/render.ts` framed the strokes in.
 */
export const sketchFigure = ({
  subject,
  author,
  elements,
  metresPerPx,
  bbox25833,
}: SketchFigureInput): FigureSpec => ({
  title: titleOf(subject, t('figure.title.sketch')),
  source: t('figure.source.sketch'),
  settings: [t('figure.set.sketchElements', { count: elements })],
  metresPerPx,
  bbox25833,
  credits: [],
  authored: authored(ROLE.tegning, author),
});

// ---------------------------------------------------------------------------
// Oppsett — a kept arrangement of the layer row, flattened
// ---------------------------------------------------------------------------

/**
 * Where one layer of a scene came from, as far as the credits line cares. Named
 * by register rather than by attachment kind: a LiDAR extract and a terrain
 * render are two products of hoydedata.no and one line on the legend. That
 * coarseness is why the role here is the generic `høydedata` — at scene
 * granularity the app cannot tell which of the two a member was.
 */
export const SCENE_LAYER_CREDITS = [
  'hoydedata',
  'nib',
  'kartverket',
  'none',
] as const;

export type SceneLayerCredit = (typeof SCENE_LAYER_CREDITS)[number];

export type SceneFigureLayer = {
  /** The member's caption, or what kind of thing it is when it has none. */
  label: string;
  /** Percent, as the row's slider holds it. Omitted for the ground. */
  opacity?: number;
  credit: SceneLayerCredit;
};

export type SceneFigureInput = Common & {
  /** The ground preset, where the scene was built over one. */
  ground?: SceneFigureLayer;
  /** The members, **bottom-to-top** — the order they were painted in. */
  layers: SceneFigureLayer[];
  metresPerPx: number;
  bbox25833: Bbox25833;
};

const SCENE_CREDITS: Record<SceneLayerCredit, SourceCredit | null> = {
  hoydedata: source(ROLE.hoydedata, CREDITS.hoydedata),
  nib: source(ROLE.ortofoto, CREDITS.nib),
  kartverket: source(ROLE.kart, CREDITS.kartverket),
  none: null,
};

/**
 * The figure for a composition. Where every other figure here names a service
 * and its parameters, this one names the pictures it is made of: the stack
 * bottom to top, each layer with the fade it was seen through, since a flatten
 * whose legend did not say "1937 ortofoto at 40 % over sky-view factor" is an
 * overlap nobody can check. The source credits are the union of its layers', so
 * a scene of nothing but sketches owes nobody upstream — but the arrangement is
 * always the author's, so the authored half is unconditional.
 */
export const sceneFigure = ({
  subject,
  author,
  ground,
  layers,
  metresPerPx,
  bbox25833,
}: SceneFigureInput): FigureSpec => {
  const all = [...(ground ? [ground] : []), ...layers];
  return {
    title: titleOf(subject, t('figure.title.scene')),
    source: t('figure.source.scene'),
    settings: [
      ...(ground ? [t('figure.set.sceneGround', { label: ground.label })] : []),
      ...layers.map((layer) =>
        t('figure.set.sceneLayer', {
          label: layer.label,
          percent: Math.round(layer.opacity ?? 100),
        }),
      ),
    ],
    metresPerPx,
    bbox25833,
    credits: dedupeCredits(
      all
        .map((layer) => SCENE_CREDITS[layer.credit])
        .filter((c): c is SourceCredit => c != null),
    ),
    authored: authored(ROLE.sammenstilling, author),
  };
};

// ---------------------------------------------------------------------------
// Screenshot — whatever was on the map, composited
// ---------------------------------------------------------------------------

/**
 * The one figure whose contents the app does not choose, so its provenance is
 * assembled from the live layer state: which ground was under it, which theme
 * layers over it, and therefore whose data is in the pixels.
 */
export type ScreenshotFigureInput = Common & {
  /** Ground mode, as the ribbon names it. */
  groundLabel: string;
  /** Whether the ground came from NiB rather than Kartverket. */
  groundIsFlyfoto: boolean;
  /** Theme layer ids; `themeLayerName` resolves each to its published name. */
  themeLayers: string[];
  /**
   * Whether anything the author put on the map was in the frame — a kept View
   * or Bilde on the ground, a sketch, a funn. A shot of nothing but the
   * background and the public theme layers is a copy of somebody else's map
   * and is credited as one; the moment the author's own reading is in the
   * pixels it becomes a composition of theirs.
   */
  composed: boolean;
  /**
   * How the heritage overlay was drawn — the render setting and the sublayers
   * left out of it; omitted when no heritage layer was on. "Outlines of the
   * automatically protected sites only" and "every register, filled" are
   * different claims about what blank ground in the picture means.
   */
  heritageRender?: string;
  metresPerPx: number;
  bbox25833: Bbox25833;
  /** OL view rotation, radians. See NorthArrowOptions. */
  rotation: number;
  language: string;
};

/**
 * The `heritageRender` line, from the live overlay settings. Here rather than in
 * `map/layers/heritage.ts` so every string the legend prints comes from one
 * file. Undefined when the overlay is at its defaults *and* fully opaque, since
 * those are recoverable from the layer names on the line above.
 */
export const describeHeritageRender = (
  details: ReadonlySet<HeritageDetail>,
  render: HeritageRender,
  opacity: number,
): string | undefined => {
  const parts = [t(`ribbon.heritage.render.${render}`)];
  if (details.size < HERITAGE_DETAILS.length) {
    parts.push(
      HERITAGE_DETAILS.filter((d) => details.has(d))
        .map((d) => t(`ribbon.heritage.detail.${d}`))
        .join(', ') || t('figure.set.heritageNone'),
    );
  }
  // Printed as transparency, like the slider that set it: a legend that
  // disagrees with its own control is worse than none.
  if (opacity < 1) {
    parts.push(
      t('figure.set.heritageTransparency', {
        percent: Math.round(100 - opacity * 100),
      }),
    );
  }
  if (parts.length === 1 && render === 'omriss') return undefined;
  return joinDot(parts);
};

export const screenshotFigure = ({
  subject,
  author,
  groundLabel,
  groundIsFlyfoto,
  themeLayers,
  composed,
  heritageRender,
  metresPerPx,
  bbox25833,
  rotation,
  language,
}: ScreenshotFigureInput): FigureSpec => ({
  title: titleOf(subject, t('figure.title.screenshot')),
  source: joinDot([t('figure.source.map'), groundLabel]),
  acquisition: themeLayers.length
    ? t('figure.acq.overlays', {
        layers: themeLayers
          .map((id) => themeLayerName(id, language))
          .join(', '),
      })
    : undefined,
  settings: [
    t('figure.set.composite'),
    ...(heritageRender ? [heritageRender] : []),
  ],
  metresPerPx,
  bbox25833,
  rotation,
  // Kartverket is always in there: the topo base under every LiDAR and
  // per-project ortofoto stack, and the whole picture in Kart mode.
  credits: dedupeCredits([
    source(ROLE.kart, CREDITS.kartverket),
    ...(groundIsFlyfoto ? [source(ROLE.ortofoto, CREDITS.nib)] : []),
    ...(themeLayers.length
      ? [source(ROLE.kulturminner, CREDITS.riksantikvaren)]
      : []),
  ]),
  ...(composed ? { authored: authored(ROLE.sammenstilling, author) } : {}),
});
