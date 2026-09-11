// Enumerates the LiDAR sources that overlap a chosen bbox: the national
// mosaic (wms.hoyde-dtm-nhm-topobathy-25833) plus every per-project layer
// from wms.hoyde-dtm-prosjekt whose declared bbox intersects the selection.
//
// Both WMS endpoints expose each style as its own named layer
// (e.g. `<prefix>:skyggerelieff`), so "styles" here really means the set of
// layer suffixes advertised in GetCapabilities under a given prefix.

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

export { fetchNationalLidarStyles };

export type LidarSource = {
  key: string;
  kind: 'national' | 'project';
  label: string;
  year: number | null;
  pointDensity: string | null;
  // DTM or DOM. Carried on the source rather than assumed by the caller
  // because every kept extract records it (`meta.model`), and a record whose
  // model is "whatever the code did that year" is one that cannot be redrawn.
  model: LidarModel;
  wmsUrl: string;
  layerPrefix: string; // 'NHM_DTM_TOPOBATHY_25833' or the project name
  styles: string[];
};

/*
 * The two constructors, and the reason the model is an argument rather than
 * a constant.
 *
 * The extract path used to be hard-wired to DTM. That was harmless while the
 * only way in was the LiDAR-uttrekk dialog, which never offered a choice —
 * and became a silent lie the moment `Behold` started keeping *the ground on
 * screen* (docs/lokalitet-view.md §4.3): the LiDAR background can be set to
 * DOM, so a DTM-only extract hands back bare terrain for a view the user was
 * reading as canopy, labelled with the canopy's settings.
 *
 * Both services publish the same style suffixes under one prefix each, so
 * teaching this the model really is one URL and one prefix. `stylesForModel`
 * is what keeps the second half honest: DOM publishes only `skyggerelieff`,
 * and asking it for `multiskyggerelieff` answers HTTP 200 with a JSON body
 * the browser decodes as a broken image.
 */
export const nationalLidarSource = (
  nationalStyles: string[],
  model: LidarModel,
): LidarSource => ({
  key: 'national',
  kind: 'national',
  label: 'Nasjonal mosaikk',
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
  // The same string for both services: the DOM WMS publishes each project
  // under its own name too.
  layerPrefix: p.projectName,
  styles: stylesForModel(p.styles, model),
});

// Produce the sortable, filtered list of sources for a selection bbox given
// in EPSG:4326 (lon/lat). National mosaic is always first. Projects are
// filtered by bbox intersection and sorted newest / densest first.
//
// `model` is required rather than defaulted: a caller that does not say which
// elevation model it wants is exactly the bug the parameter was added to fix.
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

// Best-guess native ground resolution per source, used to pick a
// sensible default when the user hasn't overridden it. Higher point
// density → finer native resolution. National mosaic is 1 m.
export function nativeResolutionMetersPerPx(source: LidarSource): number {
  if (source.kind === 'national') return 1;
  const d = source.pointDensity;
  if (!d) return 0.5;
  const m = d.match(/^(\d+)/);
  const pts = m ? parseInt(m[1], 10) : 0;
  if (pts >= 20) return 0.15;
  if (pts >= 10) return 0.2;
  if (pts >= 5) return 0.3;
  if (pts >= 2) return 0.5;
  return 1;
}
