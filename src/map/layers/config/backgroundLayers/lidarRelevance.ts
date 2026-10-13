import { atom } from 'jotai';
import { Geometry } from 'ol/geom';
import { acrossHalves, halved } from '../../../compare/halves';
import {
  densityValue,
  LidarProject,
  sortProjectsByRelevance,
} from './lidarProjects';

export type LidarFilterSettings = {
  minYear: number;

  grandfatherDense: boolean;

  minAreaRatio: number;
};

export const DEFAULT_LIDAR_FILTERS: LidarFilterSettings = {
  minYear: 2015,
  grandfatherDense: true,
  minAreaRatio: 0.1,
};

const GRANDFATHER_DENSITY_PKT = 5;

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

export const RENDER_CAP = 25;

type RelevanceInput = {
  project: LidarProject;
  areaRatio: number;
};

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

export type LidarViewportEntry = {
  project: LidarProject;

  geometries: Geometry[];

  areaRatio: number;
};

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

  | 'idle'
  | 'loading'
  | 'ready'

  | 'zoomedOut'

  | 'held'
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

export const lidarPickerOpenHalves = halved(false);

export const livePickerOpenAtom = acrossHalves(lidarPickerOpenHalves);

export const lidarCyclingAtom = atom(false);

export const hoveredLidarProjectIdAtom = atom<string | null>(null);
