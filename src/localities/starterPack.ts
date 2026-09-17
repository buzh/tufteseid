// The starter set: the best LiDAR dataset over a new rectangle, read three
// ways, without being asked. `planStarterPack` resolves dataset and styles up
// front; `extractLidarRaster` is what the pin queue calls afterwards, and
// `Behold` over the LiDAR ground goes through it too.

import type { LocalityBbox } from '../api/localities';
import { fitImageBlob } from '../figure/figure';
import { extractCanvas } from '../lidarExtract/run';
import {
  enumerateLidarSources,
  type LidarSource,
} from '../lidarExtract/sources';
import { TIER_A_STYLES } from '../map/layers/config/backgroundLayers/lidarProjects';

// The same list the style pulldown puts first, so the two cannot drift apart.
const STARTER_STYLES = TIER_A_STYLES;

/** What a stitched view hands back, so every caller has one save path. */
export type ExtractRaster = {
  blob: Blob;
  /** Identifies the dataset well enough to fetch it again. */
  sourceKey: string;
  /** Names the service in the Bilde's meta line. */
  sourceLabel: string;
  /** In the `meta.style` slot an extract already uses. */
  style: string;
  model: string;
  /** Of the pixels actually written, which may be fewer than asked for. */
  metresPerPx: number;
  bbox25833: [number, number, number, number];
};

export type ExtractOptions = {
  /** Threaded into the stitch, so a caller with a deadline can stop it. */
  signal?: AbortSignal;
};

/** One dataset and the styles the set will actually ask it for. */
export type StarterPlan = { source: LidarSource; styles: string[] };

// `enumerateLidarSources` returns the national mosaic first and the projects
// after it already sorted, so the densest one is "the second, if any".
const bestLidarSource = (sources: LidarSource[]): LidarSource | null => {
  const project = sources.find((s) => s.kind === 'project');
  return project ?? sources[0] ?? null;
};

/**
 * Resolved once, so the three images are readings of the same acquisition.
 * Filtering the styles against what the source publishes is required, not
 * defensive: the national mosaic publishes only `skyggerelieff` and answers a
 * per-project style with a 200 whose PNG is a JSON error body.
 */
export const planStarterPack = async (
  bbox4326: LocalityBbox,
): Promise<StarterPlan | null> => {
  // DTM: two of the three styles are DTM-only.
  const source = bestLidarSource(await enumerateLidarSources(bbox4326, 'dtm'));
  if (!source) return null;
  const styles = STARTER_STYLES.filter((s) => source.styles.includes(s));
  // A source publishing none of the three would otherwise give an empty pack.
  if (styles.length === 0) {
    const fallback = source.styles[0];
    if (!fallback) return null;
    return { source, styles: [fallback] };
  }
  return { source, styles };
};

/**
 * One styled LiDAR view of the rectangle, stitched from the WMS. Bare pixels,
 * edge to edge: the legend is stamped on the way out of the store, not into
 * it — see `figure/figure.ts`.
 */
export const extractLidarRaster = async (
  source: LidarSource,
  bbox25833: [number, number, number, number],
  style: string,
  { signal }: ExtractOptions = {},
): Promise<ExtractRaster | null> => {
  const result = await extractCanvas(bbox25833, source, style, signal);
  if (!result) return null;

  const fitted = await fitImageBlob(result.canvas, result.metresPerPx);
  if (!fitted) return null;

  return {
    blob: fitted.blob,
    sourceKey: source.key,
    sourceLabel: source.label,
    style,
    model: source.model,
    // What was written, not what was asked for: an oversized rectangle is
    // stored at whatever resolution fit.
    metresPerPx: fitted.metresPerPx,
    bbox25833: result.bbox25833,
  };
};
