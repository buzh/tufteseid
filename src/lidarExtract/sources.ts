import {
  bboxIntersects,
  fetchLidarProjects,
  fetchNationalLidarStyles,
  LidarProject,
  LIDAR_PROJECT_WMS_URL,
  type LidarModel,
  NATIONAL_WMS,
  sortProjectsByRelevance,
  stylesForModel,
} from '../map/layers/config/backgroundLayers/lidarProjects';

export const NATIONAL_LIDAR_LABEL = 'Nasjonal mosaikk';

export type LidarSource = {
  key: string;
  kind: 'national' | 'project';
  label: string;
  year: number | null;
  pointDensity: string | null;
  model: LidarModel;
  wmsUrl: string;
  layerPrefix: string;
  styles: string[];
};

export const nationalLidarSource = (
  nationalStyles: string[],
  model: LidarModel,
): LidarSource => ({
  key: 'national',
  kind: 'national',
  label: NATIONAL_LIDAR_LABEL,
  year: null,
  pointDensity: null,
  model,
  wmsUrl: NATIONAL_WMS[model].url,
  layerPrefix: NATIONAL_WMS[model].prefix,
  styles: stylesForModel(nationalStyles, model),
});

export const projectSourceKey = (projectName: string): string =>
  `project:${projectName}`;

export const projectLidarSource = (
  p: LidarProject,
  model: LidarModel,
): LidarSource => ({
  key: projectSourceKey(p.projectName),
  kind: 'project',
  label: p.projectName,
  year: p.year,
  pointDensity: p.pointDensity,
  model,
  wmsUrl: LIDAR_PROJECT_WMS_URL[model],
  layerPrefix: p.projectName,
  styles: stylesForModel(p.styles, model),
});

export async function enumerateLidarSources(
  bboxLonLat: [number, number, number, number],
  model: LidarModel,
): Promise<LidarSource[]> {
  const [projects, nationalStyles] = await Promise.all([
    fetchLidarProjects(),
    fetchNationalLidarStyles(),
  ]);

  const overlapping = projects
    .filter((p) => bboxIntersects(p.bboxLonLat, bboxLonLat))
    .sort(sortProjectsByRelevance)
    .map((p) => projectLidarSource(p, model));

  return [nationalLidarSource(nationalStyles, model), ...overlapping];
}

export function nativeResolutionMetersPerPx(source: LidarSource): number {
  if (source.kind === 'national') return 1;
  const d = source.pointDensity;
  if (!d) return 0.5;
  const m = d.match(/^(\d+)/);
  const pts = m ? parseInt(m[1], 10) : 0;
  if (pts >= 10) return 0.25;
  if (pts >= 5) return 0.3;
  if (pts >= 2) return 0.5;
  return 1;
}
