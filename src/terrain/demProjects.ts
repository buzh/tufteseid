import { transformExtent } from 'ol/proj';

import type { Bbox } from '../map/bbox';
import { fetchWithin } from '../shared/utils/deadline';
import { demQueryUrl, type DemModel } from './dem';

export type DemProject = {
  name: string;
  metresPerPx: number | null;
  year: number | null;
  pointDensity: number | null;
};

const TIMEOUT_MS = 20_000;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const byRelevance = (a: DemProject, b: DemProject): number =>
  (b.year ?? -Infinity) - (a.year ?? -Infinity) ||
  (b.pointDensity ?? 0) - (a.pointDensity ?? 0) ||
  a.name.localeCompare(b.name);

export const fetchDemProjects = async (
  bbox4326: Bbox,
  { model = 'dtm', signal }: { model?: DemModel; signal?: AbortSignal } = {},
): Promise<DemProject[]> => {
  const [xmin, ymin, xmax, ymax] = transformExtent(
    bbox4326,
    'EPSG:4326',
    'EPSG:25833',
  );

  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({
      xmin,
      ymin,
      xmax,
      ymax,
      spatialReference: { wkid: 25833 },
    }),
    geometryType: 'esriGeometryEnvelope',
    inSR: '25833',
    spatialRel: 'esriSpatialRelIntersects',
    where: 'OPPLOSNING IS NOT NULL',
    groupByFieldsForStatistics: 'LAS_PROJECT_NAME',
    outStatistics: JSON.stringify([
      {
        statisticType: 'min',
        onStatisticField: 'OPPLOSNING',
        outStatisticFieldName: 'best',
      },
      {
        statisticType: 'max',
        onStatisticField: 'AARSTALL',
        outStatisticFieldName: 'aar',
      },
      {
        statisticType: 'max',
        onStatisticField: 'PUNKTTETTHET',
        outStatisticFieldName: 'tetthet',
      },
    ]),
    returnGeometry: 'false',
  });

  const body = await fetchWithin(
    demQueryUrl(model, params),
    { ms: TIMEOUT_MS, what: 'DEM acquisition list', signal },
    (res) => res.json(),
  );
  if (body?.error) throw new Error('catalogue query rejected');

  const out: DemProject[] = [];
  for (const feature of body?.features ?? []) {
    const attrs = feature?.attributes ?? {};
    const name = attrs.LAS_PROJECT_NAME;
    if (typeof name !== 'string' || !name) continue;
    out.push({
      name,
      metresPerPx: num(attrs.BEST ?? attrs.best),
      year: num(attrs.AAR ?? attrs.aar),
      pointDensity: num(attrs.TETTHET ?? attrs.tetthet),
    });
  }
  return out.sort(byRelevance);
};

export const demProjectFacts = (project: DemProject): string =>
  [
    project.year,
    project.pointDensity ? `${Math.round(project.pointDensity)}pkt` : null,
  ]
    .filter(Boolean)
    .join(' · ');
