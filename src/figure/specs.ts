/*
 * One spec builder per producer of a saved raster.
 *
 * These live together rather than beside each producer so the wording, the
 * credit assignment and the level of detail stay the same across all of
 * them — a report with five figures from this app should read as five
 * figures from one instrument, not five from five.
 *
 * What goes in `settings` is the reproducibility contract: enough for
 * somebody else to ask the same service for the same picture and get it
 * back. That is why the raw WMS style name is printed verbatim rather than
 * prettified, why the multidirectional blend lists its azimuths *and* its
 * weights, and why a percentile stretch is named as one — a slope map
 * stretched 2–98 % and one stretched to its true range are different
 * pictures of the same ground.
 */

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
  // The extract tool is DTM-only by design (lidarExtract/sources.ts), so the
  // model is a constant here rather than a parameter.
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
  /**
   * Metres; `lrm` and the four horizon views only (`usesHorizon` in
   * render.ts). Omitted means the view's default.
   */
  radius?: number;
};

/**
 * VAT's layer stack, as one line: what was blended over what, at what opacity,
 * stretched between what.
 *
 * Assembled from VAT_LAYERS rather than written out, because the whole point
 * of printing it is that somebody can rebuild the same composite in RVT — and
 * a hand-written caption is one edit away from describing a blend the code no
 * longer performs.
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
  // Through the same clamp the render used rather than the number the caller
  // held: on a 0.25 m grid the horizon scan caps its search at 6 m, and a
  // caption claiming 20 m would describe a render nobody made.
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
    // Both opennesses come off the same horizon scan as sky-view factor, so
    // they record the same two numbers — the radius the horizon was searched
    // to and how many directions it was searched in. Named separately from
    // the SVF line because "SVF-radius" on a positive-openness caption reads
    // as the wrong parameter.
    //
    // Negative openness additionally records that its ramp is inverted, which
    // is the difference between "these ditches are dark" and "these ridges are
    // dark" for a reader holding the image and not the code.
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
    // The one view whose caption is longer than its controls. Nothing here is
    // adjustable: the sun is frozen, the exaggeration is 1×, and the four
    // layers are stretched between fixed values rather than to the
    // rectangle's own percentiles — which is what lets two VAT renders of
    // different hillsides be compared at all. Printing it is how a reader
    // knows the picture was not tuned to flatter this particular ground.
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
  // To reach past 24 steps of this grid the horizon scan averages the DEM down
  // first, so the four views in `usesHorizon` are read off a coarser surface
  // than the hillshade beside them and than the resolution line below claims.
  // Printed because it changes the picture: the same radius over a 1 m surface
  // and over a 0.25 m one are two different measurements of the same ground.
  if (usesHorizon(vis)) {
    const factor = horizonDecimation(dem.metresPerPx, r);
    if (factor > 1) {
      settings.push(
        t('figure.set.horizonGrid', { m: dec(dem.metresPerPx * factor, 2) }),
      );
    }
  }
  // The grid is capped, so a large rectangle is served coarser than the
  // acquisition under it publishes. Anyone comparing two renders of
  // different-sized areas needs to know which one that happened to.
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
 * The one figure with **no credits line**, and that is the correct reading
 * rather than an omission: nothing in the pixels came from a public register.
 * A sketch is an interpretation, and the caption says so instead of naming a
 * rights holder who never saw it. `captionLayout` skips empty rows, so an
 * empty list simply leaves the row out (`draw.ts`).
 *
 * It is also the one figure whose extent is the *drawing's* rather than the
 * lokalitet's — a sketch is its strokes, so the rectangle printed is the one
 * `funn/render.ts` framed them in.
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
 * Where one layer of a scene came from, as far as the credits line cares.
 *
 * Named by register rather than by attachment kind because that is the
 * question being asked — a LiDAR extract and a terrain render are two
 * products of hoydedata.no and one line on the figure.
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
 * The figure for a composition (docs/lokalitet-view.md §13.7).
 *
 * Its settings line is the stack itself, bottom to top, each layer with the
 * fade it was seen through — which is the whole reproducibility contract here.
 * Every other figure in this file names a service and the parameters it was
 * asked with; this one names *the pictures it is made of*, because that is
 * what was decided. A flatten whose caption did not say "1937 ortofoto at
 * 40 % over sky-view factor" would be a picture of an overlap nobody could
 * check, which is the one thing `src/figure/` exists to prevent.
 *
 * The credits are the union of its layers' — a scene over ortofoto owes NiB
 * exactly as a flyfoto grab does, and a scene of nothing but sketches owes
 * nobody, so the row goes out (`captionLayout` skips empty ones).
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
 * The screenshot is the one figure whose contents the app does not choose,
 * so its provenance is assembled from the live layer state instead: which
 * ground was under it, which theme layers were over it, and therefore whose
 * data is in the pixels.
 */
export type ScreenshotFigureInput = {
  subject?: string;
  /** Ground mode, as the ribbon names it. */
  groundLabel: string;
  /** Whether the ground came from NiB rather than Kartverket. */
  groundIsFlyfoto: boolean;
  themeLayers: ThemeLayerName[];
  /**
   * How the heritage overlay was drawn — the render setting, and the
   * sublayers left out of it. Omitted when no heritage layer was on.
   *
   * Not decoration: "outlines of the automatically protected sites only" and
   * "every register, filled" are different claims about what the blank ground
   * in the picture means, and only one of them says nothing was recorded
   * there.
   */
  heritageRender?: string;
  metresPerPx: number;
  bbox25833: Bbox25833;
  /** OL view rotation, radians. See NorthArrowOptions. */
  rotation: number;
  language: string;
};

/**
 * The `heritageRender` line, from the live overlay settings. Here rather than
 * in `map/layers/heritage.ts` so that module stays what it is — the WMS
 * tables — and every string the caption prints keeps coming from one file.
 *
 * Returns undefined when the overlay is at its defaults *and* fully opaque:
 * a caption listing settings nobody changed is noise, and the defaults are
 * recoverable from the layer names already on the line above.
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
  // disagrees with the control it records is worse than no caption.
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
  // Kartverket is always in there — it is the topo base under every LiDAR
  // and per-project ortofoto stack, and the whole picture in standard mode.
  credits: dedupeCredits([
    CREDITS.kartverket,
    ...(groundIsFlyfoto ? [CREDITS.nib] : []),
    ...(themeLayers.length ? [CREDITS.riksantikvaren] : []),
  ]),
});
