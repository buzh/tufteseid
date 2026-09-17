// Relevance tiering for the LiDAR picker and footprint overlay: primary shows
// immediately, secondary behind the overflow. Nothing is excluded outright.

import { atom } from 'jotai';
import { Geometry } from 'ol/geom';
import { LidarProject, sortProjectsByRelevance } from './lidarProjects';

export type LidarFilterSettings = {
  // Projects older than this are demoted, unless grandfathered below.
  minYear: number;
  // A project at >= 5 pkt/m² meets the year bar even when older than minYear.
  grandfatherDense: boolean;
  // Projects painting less than this fraction of the viewport are demoted.
  minAreaRatio: number;
};

export const DEFAULT_LIDAR_FILTERS: LidarFilterSettings = {
  minYear: 2015,
  grandfatherDense: true,
  minAreaRatio: 0.1,
};

const GRANDFATHER_DENSITY_PKT = 5;

const densityValue = (d: string | null): number => {
  if (!d) return 0;
  const m = d.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
};

export const meetsYearBar = (
  project: LidarProject,
  filters: LidarFilterSettings,
): boolean => {
  if (project.year == null) return false;
  if (project.year >= filters.minYear) return true;
  return (
    filters.grandfatherDense &&
    densityValue(project.pointDensity) >= GRANDFATHER_DENSITY_PKT
  );
};

export const meetsSizeBar = (
  areaRatio: number,
  filters: LidarFilterSettings,
): boolean => areaRatio >= filters.minAreaRatio;

// How many entries ever get a list row. Applied after the WFS response, so
// download cost is the extent guard's job.
export const RENDER_CAP = 25;

type RelevanceInput = {
  project: LidarProject;
  areaRatio: number;
};

// `sorted` arrives in display order (sortByOnScreenCoverage); this only tiers.
export const classifyRelevance = <T extends RelevanceInput>(
  sorted: T[],
  filters: LidarFilterSettings,
): { primary: T[]; secondary: T[] } => {
  const primary: T[] = [];
  const secondary: T[] = [];
  for (const entry of sorted) {
    const isPrimary =
      meetsYearBar(entry.project, filters) &&
      meetsSizeBar(entry.areaRatio, filters);
    (isPrimary ? primary : secondary).push(entry);
  }
  const cappedPrimary = primary.slice(0, RENDER_CAP);
  const remaining = RENDER_CAP - cappedPrimary.length;
  const cappedSecondary = remaining > 0 ? secondary.slice(0, remaining) : [];
  return { primary: cappedPrimary, secondary: cappedSecondary };
};

export const lidarFilterSettingsAtom = atom<LidarFilterSettings>(
  DEFAULT_LIDAR_FILTERS,
);

// One entry per viewport candidate; the picker and the footprint layer share
// one fetch and classify pass.
export type LidarViewportEntry = {
  project: LidarProject;
  // WFS polygon parts, at least one of which touches the viewport.
  geometries: Geometry[];
  // Fraction of the viewport those polygons paint, 0..1 (viewportCoverage).
  areaRatio: number;
};

// Bucketed at 5% so near-identical candidates fall back to newest/densest
// instead of swapping places on sampling noise while panning.
const COVERAGE_BUCKET = 0.05;

export const sortByOnScreenCoverage = (
  a: LidarViewportEntry,
  b: LidarViewportEntry,
): number => {
  const bucket = (ratio: number) => Math.round(ratio / COVERAGE_BUCKET);
  return (
    bucket(b.areaRatio) - bucket(a.areaRatio) ||
    sortProjectsByRelevance(a.project, b.project)
  );
};

export type LidarViewportStatus =
  // Not in LiDAR mode: nothing fetched, nothing drawn.
  | 'idle'
  | 'loading'
  | 'ready'
  // Viewport too wide to ask the WFS about.
  | 'zoomedOut'
  | 'error';

export type LidarViewportState = {
  status: LidarViewportStatus;
  primary: LidarViewportEntry[];
  secondary: LidarViewportEntry[];
};

export const emptyLidarViewport = (
  status: LidarViewportStatus,
): LidarViewportState => ({ status, primary: [], secondary: [] });

export const lidarViewportAtom = atom<LidarViewportState>(
  emptyLidarViewport('idle'),
);

// The footprint polygons are a picking aid, so they hang off the pulldown.
export const lidarPickerOpenAtom = atom(false);

// Set while datasets are cycled from the keyboard: same WFS fetch, no polygons.
// Cleared by useLidarControls after an idle period.
export const lidarCyclingAtom = atom(false);

// The focused pulldown row: only its footprint is drawn, alongside the active
// dataset's, since all of them at once is an unreadable stack of outlines.
export const hoveredLidarProjectIdAtom = atom<string | null>(null);
