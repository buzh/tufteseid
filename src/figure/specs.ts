// One spec builder per producer of a saved raster, kept together rather than
// beside each producer so the wording and the credit assignment stay the same
// across all of them. `settings` is the reproducibility contract: enough for
// somebody else to ask the same service for the same picture. Hence the raw WMS
// style name verbatim, the multidirectional blend's azimuths *and* weights, and
// a percentile stretch named as one — a slope map stretched 2–98 % and one
// stretched to its true range are different pictures of the same ground.

import { t } from 'i18next';
import type { FlyfotoProject } from '../localities/flyfotoProjects';
import {
  HERITAGE_DETAILS,
  type HeritageDetail,
  type HeritageRender,
} from '../map/layers/heritage';
import { themeLayerName } from '../map/layers/themeLayerConfigApi';
import type { ThemeLayerName } from '../map/layers/themeWMS';
import type { Dem, DemModel } from '../terrain/dem';
import {
  clampRadius,
  defaultRadius,
  usesHorizon,
  type TerrainLight,
} from '../terrain/render';
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
import { type Credit, type FigureSpec, CREDITS } from './figure';

type Bbox25833 = [number, number, number, number];

/** The lokalitet's name in front of the product, when there is one. */
const titleOf = (subject: string | undefined, product: string) =>
  subject ? `${subject} · ${product}` : product;

/** Two rights holders with the same name are one line on the figure. */
const dedupeCredits = (credits: Credit[]): Credit[] => {
  const seen = new Set<string>();
  return credits.filter((c) => {
    if (seen.has(c.holder)) return false;
    seen.add(c.holder);
    return true;
  });
};

// ---------------------------------------------------------------------------
// LiDAR extract — Kartverket's pre-baked relief, stitched from WMS
// ---------------------------------------------------------------------------

export type LidarExtractFigureInput = {
  subject?: string;
  /** The source's own name: a project name, or the national mosaic. */
  sourceLabel: string;
  /** The WMS style suffix, verbatim — this is what makes it re-requestable. */
  style: string;
  year?: number | null;
  pointDensity?: string | null;
  metresPerPx: number;
  bbox25833: Bbox25833;
};

export const lidarExtractFigure = (
  input: LidarExtractFigureInput,
): FigureSpec => ({
  title: titleOf(
    input.subject,
    `${t('figure.title.extract')} — ${input.style}`,
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
  credits: [CREDITS.hoydedata],
});

// ---------------------------------------------------------------------------
// Terrenganalyse — relief computed here from the float DEM
// ---------------------------------------------------------------------------

export type TerrainFigureInput = {
  subject?: string;
  vis: Visualization;
  model: DemModel;
  light: TerrainLight;
  dem: Dem;
  /** Metres; `lrm` and the horizon views only. Omitted means the default. */
  radius?: number;
};

/**
 * VAT's layer stack as one line: what was blended over what, at what opacity,
 * stretched between what. Assembled from VAT_LAYERS rather than written out,
 * because a hand-written caption is one edit away from describing a blend the
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
  dem,
  radius,
}: Pick<TerrainFigureInput, 'vis' | 'light' | 'dem' | 'radius'>): string[] => {
  const settings: string[] = [];
  // Through the same clamp the render used, not the number the caller held, or
  // the caption describes a render nobody made.
  const r = clampRadius(vis, dem, radius ?? defaultRadius(vis));
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
    // their own label, because "SVF-radius" on an openness caption reads as the
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
    const factor = horizonDecimation(dem.metresPerPx, r);
    if (factor > 1) {
      settings.push(
        t('figure.set.horizonGrid', { m: dec(dem.metresPerPx * factor, 2) }),
      );
    }
  }
  // The grid is capped, so a large rectangle is served coarser than the
  // acquisition under it publishes.
  if (dem.nativeMetresPerPx < dem.metresPerPx) {
    settings.push(
      t('figure.set.resampled', { m: dec(dem.nativeMetresPerPx, 2) }),
    );
  }
  return settings;
};

export const terrainFigure = ({
  subject,
  vis,
  model,
  light,
  dem,
  radius,
}: TerrainFigureInput): FigureSpec => ({
  title: titleOf(
    subject,
    `${t('figure.title.terrain')} — ${t(`localities.terrain.vis.${vis}`)}`,
  ),
  source: t('figure.source.dem', { model: model.toUpperCase() }),
  settings: terrainSettings({ vis, light, dem, radius }),
  metresPerPx: dem.metresPerPx,
  bbox25833: dem.bbox25833,
  credits: [CREDITS.hoydedata],
});

// ---------------------------------------------------------------------------
// Flyfoto — Norge i bilder ortofoto
// ---------------------------------------------------------------------------

export type FlyfotoFigureInput = {
  subject?: string;
  /** Absent for the seamless best-available mosaic. */
  project?: FlyfotoProject;
  metresPerPx: number;
  bbox25833: Bbox25833;
};

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
  credits: [CREDITS.nib],
});

// ---------------------------------------------------------------------------
// Skisse — the author's own hand, re-exported
// ---------------------------------------------------------------------------

export type SketchFigureInput = {
  subject?: string;
  /** How many strokes and shapes the scene holds. */
  elements: number;
  metresPerPx: number;
  bbox25833: Bbox25833;
};

/**
 * The one figure with no credits line, and that is the reading rather than an
 * omission: nothing in the pixels came from a public register, and the caption
 * layout drops empty rows. Its extent is the *drawing's* rather than the
 * lokalitet's — the rectangle `funn/render.ts` framed the strokes in.
 */
export const sketchFigure = ({
  subject,
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
});

// ---------------------------------------------------------------------------
// Oppsett — a kept arrangement of the layer row, flattened
// ---------------------------------------------------------------------------

/**
 * Where one layer of a scene came from, as far as the credits line cares. Named
 * by register rather than by attachment kind: a LiDAR extract and a terrain
 * render are two products of hoydedata.no and one line on the figure.
 */
export type SceneLayerCredit = 'hoydedata' | 'nib' | 'kartverket' | 'none';

export type SceneFigureLayer = {
  /** The member's caption, or what kind of thing it is when it has none. */
  label: string;
  /** Percent, as the row's slider holds it. Omitted for the ground. */
  opacity?: number;
  credit: SceneLayerCredit;
};

export type SceneFigureInput = {
  subject?: string;
  /** The ground preset, where the scene was built over one. */
  ground?: SceneFigureLayer;
  /** The members, **bottom-to-top** — the order they were painted in. */
  layers: SceneFigureLayer[];
  metresPerPx: number;
  bbox25833: Bbox25833;
};

const SCENE_CREDITS: Record<SceneLayerCredit, Credit | null> = {
  hoydedata: CREDITS.hoydedata,
  nib: CREDITS.nib,
  kartverket: CREDITS.kartverket,
  none: null,
};

/**
 * The figure for a composition. Where every other figure here names a service
 * and its parameters, this one names the pictures it is made of: the stack
 * bottom to top, each layer with the fade it was seen through, since a flatten
 * whose caption did not say "1937 ortofoto at 40 % over sky-view factor" is an
 * overlap nobody can check. The credits are the union of its layers', so a
 * scene of nothing but sketches owes nobody and the row goes out.
 */
export const sceneFigure = ({
  subject,
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
        .filter((c): c is Credit => c != null),
    ),
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
export type ScreenshotFigureInput = {
  subject?: string;
  /** Ground mode, as the ribbon names it. */
  groundLabel: string;
  /** Whether the ground came from NiB rather than Kartverket. */
  groundIsFlyfoto: boolean;
  themeLayers: ThemeLayerName[];
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
 * `map/layers/heritage.ts` so every string the caption prints comes from one
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
  // Printed as transparency, like the slider that set it: a caption that
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
  groundLabel,
  groundIsFlyfoto,
  themeLayers,
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
  // per-project ortofoto stack, and the whole picture in standard mode.
  credits: dedupeCredits([
    CREDITS.kartverket,
    ...(groundIsFlyfoto ? [CREDITS.nib] : []),
    ...(themeLayers.length ? [CREDITS.riksantikvaren] : []),
  ]),
});
