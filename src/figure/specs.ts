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
import type { LidarSource } from '../lidarExtract/sources';
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
  DEFAULT_LRM_RADIUS,
  DEFAULT_SVF_RADIUS,
  type TerrainLight,
} from '../terrain/render';
import {
  MULTI_AZIMUTHS,
  SVF_DIRECTIONS,
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

/** Pull the acquisition facts off an enumerated source, when one is at hand. */
export const lidarSourceFacts = (
  source: LidarSource | undefined,
): Pick<LidarExtractFigureInput, 'year' | 'pointDensity'> => ({
  year: source?.year ?? null,
  pointDensity: source?.pointDensity ?? null,
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
};

const terrainSettings = ({
  vis,
  light,
  dem,
}: Pick<TerrainFigureInput, 'vis' | 'light' | 'dem'>): string[] => {
  const settings: string[] = [];
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
        t('figure.set.stretch'),
      );
      break;
    case 'lrm':
      settings.push(
        t('figure.set.lrmRadius', { m: DEFAULT_LRM_RADIUS }),
        t('figure.set.diverging'),
        t('figure.set.stretch'),
      );
      break;
    case 'svf':
      settings.push(
        t('figure.set.svfRadius', { m: DEFAULT_SVF_RADIUS }),
        t('figure.set.svfDirections', { n: SVF_DIRECTIONS }),
        t('figure.set.stretch'),
      );
      break;
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
}: TerrainFigureInput): FigureSpec => ({
  title: titleOf(
    subject,
    `${t('figure.title.terrain')} — ${t(`localities.terrain.vis.${vis}`)}`,
  ),
  source: t('figure.source.dem', { model: model.toUpperCase() }),
  settings: terrainSettings({ vis, light, dem }),
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
  if (opacity < 1) {
    parts.push(
      t('figure.set.heritageOpacity', { percent: Math.round(opacity * 100) }),
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
