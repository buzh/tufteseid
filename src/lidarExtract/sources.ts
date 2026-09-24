// Each style is its own named layer (`<prefix>:skyggerelieff`), so "styles"
// here is the set of layer suffixes advertised under a prefix.

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

// The catalogue's own name for the seamless best-available ground, not a
// user-visible string: it is written into a kept render's provenance and has to
// read the same years later, in any locale.
export const NATIONAL_LIDAR_LABEL = 'Nasjonal mosaikk';

export type LidarSource = {
  key: string;
  kind: 'national' | 'project';
  label: string;
  year: number | null;
  pointDensity: string | null;
  model: LidarModel;
  wmsUrl: string;
  layerPrefix: string; // 'NHM_DTM_TOPOBATHY_25833' or the project name
  styles: string[];
};

// `stylesForModel` is not optional: DOM publishes only `skyggerelieff`, and
// asking it for `multiskyggerelieff` answers HTTP 200 with a JSON body the
// browser decodes as a broken image.
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

export const projectLidarSource = (
  p: LidarProject,
  model: LidarModel,
): LidarSource => ({
  key: `project:${p.projectName}`,
  kind: 'project',
  label: p.projectName,
  year: p.year,
  pointDensity: p.pointDensity,
  model,
  wmsUrl: LIDAR_PROJECT_WMS_URL[model],
  // The same string for both services; the DOM WMS uses the project name too.
  layerPrefix: p.projectName,
  styles: stylesForModel(p.styles, model),
});

// bbox in EPSG:4326.
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

// 0.25 m is the data's floor: the per-project models are published on a 0.25 m
// grid and 10 pkt/m² is 0.32 m mean spacing.
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
