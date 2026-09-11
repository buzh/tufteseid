// The starter set — the images worth having before you start reading a
// rectangle, produced without asking which.
//
// A lokalitet is made in one press from the visible map, and what you want
// next is always the same thing: the laser, read three ways. Picking each of
// those by hand is a dialog and half a dozen decisions the register can make
// better than the user can — which LiDAR project covers here at the finest
// point density, and which styled variants it actually publishes.
//
// Three styles, one service, one fetch path: `skyggerelieff` (the fixed
// north-west hillshade every source advertises), `multiskyggerelieff` (every
// direction at once, so nothing hides along the sun) and `helning_prosent`
// (slope, which shows edges the light misses). They are Kartverket's own
// pre-baked renders, so nothing here has settings a user did not choose and
// cannot check — see docs/lokalitet-view.md §4.3 for why the terrain render
// and the flyfoto left this set.
//
// This module only *makes* the images. Captions, `createAttachment` and the
// gallery's optimistic update stay in useLocalityWorkspace, where the
// translations and the record ids are — see `runStarterPack` there.
//
// `extractLidarFigure` is the general one-styled-view-of-the-rectangle call
// and is not the starter set's alone: `Behold` over the LiDAR ground is the
// same fetch at whichever dataset and style the map is showing, so it comes
// through here too. One path means one place where the provenance figure and
// the recorded meta can go wrong.
//
// Every image goes out as a provenance figure (src/figure), same as when it
// is produced by hand: an image nobody chose the settings for is exactly the
// one whose settings have to be written on it.

import type { LocalityBbox } from '../api/localities';
import { type ImageRect, renderFigureBlob } from '../figure/figure';
import { lidarExtractFigure } from '../figure/specs';
import { extractCanvas } from '../lidarExtract/run';
import {
  enumerateLidarSources,
  type LidarSource,
} from '../lidarExtract/sources';
import { TIER_A_STYLES } from '../map/layers/config/backgroundLayers/lidarProjects';

/**
 * The three styles, in the order they are fetched and shown.
 *
 * The same three the style pulldown puts first, and for the same reason:
 * they are the most diagnostic variants for reading archaeology in terrain.
 * One list, so the starter set and the ring can never drift apart.
 */
export const STARTER_STYLES = TIER_A_STYLES;

/** What a stitched view hands back, so every caller has one save path. */
export type ExtractRaster = {
  blob: Blob;
  /** Identifies the dataset well enough to fetch it again. */
  sourceKey: string;
  /** Names the service in the Bilde's meta line. */
  sourceLabel: string;
  /** The styled variant, in the `meta.style` slot an extract already uses. */
  style: string;
  /** DTM or DOM. Implicit in the extract path today; recorded anyway. */
  model: string;
  metresPerPx: number;
  bbox25833: [number, number, number, number];
  /** Where the image sits inside the figure — the caption is below it. */
  imageRect: ImageRect;
};

/** The lokalitet's name for the figure's title line, and the abort signal. */
export type ExtractOptions = { subject?: string; signal?: AbortSignal };

/** One dataset and the styles the set will actually ask it for. */
export type StarterPlan = { source: LidarSource; styles: string[] };

/**
 * The best LiDAR source over this rectangle: the densest, newest per-project
 * acquisition covering it, or the national 1 m mosaic when none does.
 *
 * `enumerateLidarSources` returns the national mosaic first and the projects
 * after it already sorted by relevance, so this is "the second one, if there
 * is one".
 */
const bestLidarSource = (sources: LidarSource[]): LidarSource | null => {
  const project = sources.find((s) => s.kind === 'project');
  return project ?? sources[0] ?? null;
};

/**
 * Which dataset the set comes from, and how many images it will be.
 *
 * Resolved once and handed to every `extractLidarFigure` call, so three images
 * cost one catalogue lookup and are guaranteed to be three readings of the
 * *same* acquisition — which is the only way flipping between them means
 * anything.
 *
 * The styles are filtered against what the chosen source publishes, and that
 * filter is load-bearing rather than defensive: **the national mosaic
 * publishes only `skyggerelieff`**, and asking it for a per-project style
 * does not fail loudly — it answers HTTP 200, `Content-Type: image/png`,
 * with a ~100 byte JSON error body that the browser decodes as a broken
 * image. So where no project covers the rectangle the starter set is one
 * image, not three silent failures.
 */
export const planStarterPack = async (
  bbox4326: LocalityBbox,
): Promise<StarterPlan | null> => {
  // DTM, always. Two of the three styles are DTM-only, and the starter set is
  // what a lokalitet gets before anybody has expressed a preference — reading
  // the bare ground is the one that answers the archaeological question.
  const source = bestLidarSource(await enumerateLidarSources(bbox4326, 'dtm'));
  if (!source) return null;
  const styles = STARTER_STYLES.filter((s) => source.styles.includes(s));
  // A dataset that publishes none of the three is not one we have seen, but
  // it would produce an empty pack rather than an honest one image.
  if (styles.length === 0) {
    const fallback = source.styles[0];
    if (!fallback) return null;
    return { source, styles: [fallback] };
  }
  return { source, styles };
};

/** One styled LiDAR view of the rectangle, stitched from the WMS. */
export const extractLidarFigure = async (
  source: LidarSource,
  bbox25833: [number, number, number, number],
  style: string,
  { subject, signal }: ExtractOptions = {},
): Promise<ExtractRaster | null> => {
  const result = await extractCanvas(bbox25833, source, style, signal);
  if (!result) return null;

  const figure = await renderFigureBlob(
    result.canvas,
    lidarExtractFigure({
      subject,
      sourceLabel: source.label,
      style,
      year: source.year,
      pointDensity: source.pointDensity,
      metresPerPx: result.metresPerPx,
      bbox25833: result.bbox25833,
    }),
  );
  if (!figure) return null;

  return {
    blob: figure.blob,
    imageRect: figure.imageRect,
    sourceKey: source.key,
    sourceLabel: source.label,
    style,
    model: source.model,
    metresPerPx: result.metresPerPx,
    bbox25833: result.bbox25833,
  };
};
