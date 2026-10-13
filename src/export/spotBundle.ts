import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import { t } from 'i18next';
import { transform } from 'ol/proj';

import { evidenceFileUrl, type EvidenceRecord } from '../api/evidence';
import type { SpotFootprint, SpotRecord } from '../api/spots';
import { extensionOf } from '../evidence/download';
import { canvasBlob } from '../evidence/fit';
import { evidenceTitle } from '../evidence/labels';
import { centreOf, legendContentFor } from '../evidence/legendContent';
import {
  evidenceBandTop,
  evidenceBbox,
  isVideoEvidence,
  specOf,
} from '../evidence/spec';
import { bboxToMetric } from '../map/bbox';
import { sanitizeFilename } from '../shared/utils/filename';
import { renderScene } from '../sketch/render';
import { sketchOf } from '../sketch/scene';
import { shareUrlOf } from '../spots/shareLink';
import { CRS_WKT, EXPORT_CRS, worldExtension, worldFile } from './georef';
import { qgisProject, type ProjectRaster } from './qgisProject';
import { zip, type ZipEntry } from './zip';

const PICTURES_DIR = 'bilder';
const SKETCH_NAME = 'tegning';
const README_NAME = 'LESMEG.txt';

const SKETCH_LAYER = 'Tegning';

const SKETCH_SCALE = 1;

const text = (body: string): Blob =>
  new Blob([body], { type: 'text/plain;charset=utf-8' });

const json = (body: unknown): Blob =>
  new Blob([JSON.stringify(body, null, 2)], {
    type: 'application/geo+json',
  });

const footprintRing = (footprint: SpotFootprint): number[][] => {
  const [minX, minY, maxX, maxY] = bboxToMetric(footprint);
  return (
    [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
      [minX, minY],
    ] as [number, number][]
  ).map((corner) => transform(corner, EXPORT_CRS, 'EPSG:4326'));
};

const spotProperties = (spot: SpotRecord) => ({
  code: spot.code,
  name: spot.name,
  description: spot.description,
  credit: spot.credit,
  visibility: spot.visibility,
  created: spot.created,
  updated: spot.updated,
  url: spot.visibility === 'public' ? shareUrlOf(spot.code) : '',
});

const collection = (
  feature: Feature<Point | Polygon>,
): FeatureCollection<Point | Polygon> => ({
  type: 'FeatureCollection',
  features: [feature],
});

const pointFeature = (spot: SpotRecord): Feature<Point> => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: spot.point },
  properties: spotProperties(spot),
});

const footprintFeature = (
  spot: SpotRecord,
  footprint: SpotFootprint,
): Feature<Polygon> => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [footprintRing(footprint)] },
  properties: spotProperties(spot),
});

const imageSize = async (
  blob: Blob,
): Promise<{ width: number; height: number } | null> => {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
};

const georeferenced = async (
  path: string,
  extension: string,
  blob: Blob,
  bbox25833: [number, number, number, number],
): Promise<ZipEntry[]> => {
  const entries: ZipEntry[] = [{ path: `${path}.${extension}`, body: blob }];
  const size = await imageSize(blob);
  const world = size && worldFile(bbox25833, size.width, size.height);
  if (!world) return entries;
  entries.push(
    { path: `${path}.${worldExtension(extension)}`, body: text(world) },
    { path: `${path}.prj`, body: text(CRS_WKT) },
  );
  return entries;
};

type Picture = {
  entries: ZipEntry[];
  credit: string[];
  layer: ProjectRaster | null;
};

const pictureOf = async (
  rec: EvidenceRecord,
  spot: SpotRecord,
  index: number,
  folder: string,
): Promise<Picture | null> => {
  const url = evidenceFileUrl(rec);
  if (!url) return null;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`file ${response.status}`);
  const blob = await response.blob();

  const spec = specOf(rec);
  const title = spec ? evidenceTitle(spec) : t('evidence.unreadable');
  const stem = `${String(index).padStart(2, '0')}_${sanitizeFilename(title)}`;
  const path = `${folder}/${PICTURES_DIR}/${stem}`;
  const extension = extensionOf(blob.type);
  const bbox = evidenceBbox(rec);

  const ground =
    !isVideoEvidence(rec) && evidenceBandTop(rec) === 1 ? bbox : null;

  const entries = ground
    ? await georeferenced(path, extension, blob, ground)
    : [{ path: `${path}.${extension}`, body: blob }];

  const content = legendContentFor(rec, spot, bbox ? centreOf(bbox) : '');
  const name = `${stem}.${extension}`;
  const credit = content
    ? [
        name,
        `  ${[content.title, ...content.facts].join(' · ')}`,
        ...content.rights.map((line) => `  ${line}`),
      ]
    : [name];
  if (isVideoEvidence(rec)) {
    credit.push(`  ${t('export.readme.video')}`);
  }

  const layer = ground
    ? {
        name: stem,
        path: `${PICTURES_DIR}/${stem}.${extension}`,
        bbox25833: ground,
        alpha: extension === 'png',
      }
    : null;

  return { entries, credit, layer };
};

type Drawing = { entries: ZipEntry[]; layer: ProjectRaster | null };

const sketchEntries = async (
  spot: SpotRecord,
  folder: string,
): Promise<Drawing> => {
  const none = { entries: [], layer: null };
  const sketch = sketchOf(spot.sketch);
  if (!sketch) return none;
  const render = await renderScene(sketch.frame, sketch.elements, SKETCH_SCALE);
  if (!render) return none;
  const blob = await canvasBlob(render.canvas, 'image/png');
  if (!blob) return none;
  return {
    entries: await georeferenced(
      `${folder}/${SKETCH_NAME}`,
      'png',
      blob,
      render.extent25833,
    ),
    layer: {
      name: SKETCH_LAYER,
      path: `${SKETCH_NAME}.png`,
      bbox25833: render.extent25833,
      alpha: true,
    },
  };
};

type Held = { footprint: boolean; sketch: boolean };

const readme = (
  spot: SpotRecord,
  slug: string,
  credits: string[][],
  held: Held,
): string => {
  const lines = [
    t('export.readme.heading', {
      name: spot.name,
      app: t('evidence.figure.app'),
    }),
    '',
    t('export.readme.project', { file: `${slug}.qgs` }),
    '',
    t('export.readme.raster'),
    t('export.readme.vector', { file: `${slug}_punkt.geojson` }),
  ];
  if (held.footprint) {
    lines.push(
      t('export.readme.footprint', { file: `${slug}_utsnitt.geojson` }),
    );
  }
  if (held.sketch) {
    lines.push(t('export.readme.sketch', { file: `${SKETCH_NAME}.png` }));
  }
  if (spot.visibility === 'public') {
    lines.push('', shareUrlOf(spot.code));
  }
  lines.push('', t('export.readme.pictures'), '');
  if (credits.length === 0) {
    lines.push(t('export.readme.noPictures'));
  } else {
    for (const block of credits) lines.push(...block, '');
  }
  return lines.join('\n');
};

export type SpotBundle = { blob: Blob; filename: string };

export const buildSpotBundle = async (
  spot: SpotRecord,
  rows: readonly EvidenceRecord[],
): Promise<SpotBundle> => {
  const slug = sanitizeFilename(spot.name);
  const entries: ZipEntry[] = [];
  const credits: string[][] = [];
  const pictures: ProjectRaster[] = [];

  let index = 0;
  for (const rec of rows) {
    if (!rec.file) continue;
    index += 1;
    const picture = await pictureOf(rec, spot, index, slug);
    if (!picture) continue;
    entries.push(...picture.entries);
    credits.push(picture.credit);
    if (picture.layer) pictures.push(picture.layer);
  }

  const sketch = await sketchEntries(spot, slug);
  entries.push(...sketch.entries);

  const layers = sketch.layer ? [sketch.layer, ...pictures] : pictures;
  entries.push({
    path: `${slug}/${slug}.qgs`,
    body: text(
      qgisProject(
        spot.name,
        layers,
        spot.footprint ? bboxToMetric(spot.footprint) : null,
      ),
    ),
  });

  entries.push({
    path: `${slug}/${slug}_punkt.geojson`,
    body: json(collection(pointFeature(spot))),
  });
  if (spot.footprint) {
    entries.push({
      path: `${slug}/${slug}_utsnitt.geojson`,
      body: json(collection(footprintFeature(spot, spot.footprint))),
    });
  }
  entries.push({
    path: `${slug}/${README_NAME}`,
    body: text(
      readme(spot, slug, credits, {
        footprint: spot.footprint != null,
        sketch: sketch.layer != null,
      }),
    ),
  });

  return { blob: await zip(entries), filename: `${slug}.zip` };
};
