// Which LiDAR acquisitions hoydedata holds over one rectangle. Off the same
// image service the elevation itself comes from, because the name this answers
// with is the one a render's `meta.source` carries and the one the sidecar
// filters its mosaic by (`docs/render-sidecar.md`) — the WMS catalogue
// (`lidarProjects.ts`) names the same flights but is a different service's
// vocabulary, and only this one is guaranteed to agree with the pixels.

import { transformExtent } from 'ol/proj';

import type { Bbox } from '../map/bbox';
import { fetchWithin } from '../shared/utils/deadline';
import { demQueryUrl, type DemModel } from './dem';

export type DemProject = {
  /** `LAS_PROJECT_NAME`, e.g. "NDH Vestfold 5pkt 2016". */
  name: string;
  /** Finest OPPLOSNING this acquisition publishes over the rectangle. */
  metresPerPx: number | null;
  year: number | null;
  /** Points per m², as the catalogue reports it. */
  pointDensity: number | null;
};

const TIMEOUT_MS = 20_000;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

// Newest first, then densest: the order a reader picking a flight wants, and
// the same one the ground's dataset menu uses.
const byRelevance = (a: DemProject, b: DemProject): number =>
  (b.year ?? -Infinity) - (a.year ?? -Infinity) ||
  (b.pointDensity ?? 0) - (a.pointDensity ?? 0) ||
  a.name.localeCompare(b.name);

/** The acquisitions covering any part of `bbox4326`, newest first. Empty where
 *  the catalogue holds no laser data there; throws where the query itself
 *  failed, which is not the same answer. */
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
    // The 10 m fallback rows have no OPPLOSNING and are nothing a render can
    // ask for by name.
    where: 'OPPLOSNING IS NOT NULL',
    // One row per acquisition instead of one per tile: a footprint sits on
    // dozens of tiles of the same flight. `returnDistinctValues` is answered
    // but not honoured by this service, so the grouping has to be the
    // statistics'.
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
  // The service upper-cases every outStatisticFieldName.
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

/** Year and density, the line the dataset menu shows under a flight's name. */
export const demProjectFacts = (project: DemProject): string =>
  [
    project.year,
    project.pointDensity ? `${Math.round(project.pointDensity)}pkt` : null,
  ]
    .filter(Boolean)
    .join(' · ');
