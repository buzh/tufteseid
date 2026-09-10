// "Hent grunnpakke" — the three images worth having before you start
// reading a rectangle, produced without asking which.
//
// A lokalitet is made in one press from the visible map, and what you want
// next is always the same three things: what the ground looks like from the
// air, what the laser sees through the trees, and what the relief looks like
// with the light moved off the pre-baked north-west. Picking each of those by
// hand is three dialogs and half a dozen decisions the register can make
// better than the user can — which acquisition is newest, which LiDAR project
// covers here at the finest point density.
//
// This module only *makes* the images. Captions, `createAttachment` and the
// gallery's optimistic update stay in useLocalityWorkspace, where the
// translations and the record ids are — see `runStarterPack` there.

import type { LocalityBbox } from '../api/localities';
import { extractCanvas } from '../lidarExtract/run';
import {
  enumerateLidarSources,
  type LidarSource,
} from '../lidarExtract/sources';
import { renderTerrain } from '../terrain/render';
import type { Visualization } from '../terrain/shade';

/** The order they are fetched in, and the order they appear in Bilder. */
export const STARTER_STEPS = ['flyfoto', 'extract', 'terrain'] as const;
export type StarterStep = (typeof STARTER_STEPS)[number];

/** What every step hands back, so the caller has one save path. */
export type StarterRaster = {
  blob: Blob;
  /** Names the service in the Bilde's meta line. */
  sourceLabel: string;
  /** The visualization, in the same `meta.style` slot an extract already uses. */
  style: string;
  metresPerPx: number;
  bbox25833: [number, number, number, number];
};

// The hillshade every LiDAR source advertises. A starter pack is not the
// place to offer helning_prosent — one legible image beats five to pick from,
// and the extract tool is still right there for the rest.
const STARTER_STYLE = 'skyggerelieff';

// Multidirectional rather than the plain hillshade: it needs no azimuth
// chosen for it, and a single sun angle hides whatever happens to run along
// it — which for a starter image is the failure that costs the most, because
// nobody goes back to re-light a render they were handed.
const STARTER_VIS: Visualization = 'multiHillshade';

const toPng = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

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

/** A LiDAR hillshade of the rectangle, stitched from the WMS. */
export const starterExtract = async (
  bbox4326: LocalityBbox,
  bbox25833: [number, number, number, number],
  signal?: AbortSignal,
): Promise<StarterRaster | null> => {
  const sources = await enumerateLidarSources(bbox4326);
  const source = bestLidarSource(sources);
  if (!source) return null;
  const style = source.styles.includes(STARTER_STYLE)
    ? STARTER_STYLE
    : source.styles[0];
  if (!style) return null;

  const result = await extractCanvas(bbox25833, source, style, signal);
  if (!result) return null;
  const blob = await toPng(result.canvas);
  if (!blob) return null;

  return {
    blob,
    sourceLabel: source.label,
    style,
    metresPerPx: result.metresPerPx,
    bbox25833: result.bbox25833,
  };
};

/**
 * A relief render computed here from the float DEM, which is a different
 * picture from the extract above even at the same resolution — that one is
 * Kartverket's fixed north-west hillshade, this one is every direction at
 * once. Seeing the two side by side is most of the point of the pack.
 */
export const starterTerrain = async (
  bbox4326: LocalityBbox,
  sourceLabel: string,
  signal?: AbortSignal,
): Promise<StarterRaster | null> => {
  const render = await renderTerrain(bbox4326, {
    vis: STARTER_VIS,
    signal,
  });
  if (!render) return null;
  const blob = await toPng(render.canvas);
  if (!blob) return null;

  return {
    blob,
    sourceLabel,
    style: STARTER_VIS,
    metresPerPx: render.dem.metresPerPx,
    bbox25833: render.dem.bbox25833,
  };
};
