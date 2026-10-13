import type { EvidenceMeta } from '../api/evidence';
import { extractCanvas } from '../lidarExtract/run';
import {
  enumerateLidarSources,
  projectSourceKey,
} from '../lidarExtract/sources';
import { bboxToMetric, type Bbox } from '../map/bbox';
import { fetchCvatAcquisitions } from '../map/layers/config/backgroundLayers/cvatGround';
import { fetchFlyfotoProjectsForBbox } from '../map/layers/config/backgroundLayers/flyfotoProjects';
import { CVAT_STYLE } from '../map/layers/config/backgroundLayers/lidarProjects';
import { sanitizeFilename } from '../shared/utils/filename';
import { fetchDem } from '../terrain/dem';
import {
  clampRadius,
  demImageExtent,
  paintTerrainField,
  terrainField,
  terrainStaticField,
} from '../terrain/render';
import { fetchCvatRaster } from './cvatRaster';
import { fitImageBlob, type Raster } from './fit';
import { fetchFlyfotoRaster } from './flyfotoRaster';
import { NIB_MOSAIC, type EvidenceSpec } from './spec';

export type Produced = {
  blob: Blob;
  filename: string;
  meta: EvidenceMeta;
};

export type BrowserSpec = Exclude<EvidenceSpec, { kind: 'sunloop' | 'rvt' }>;

const produce = async (
  raster: Raster,
  filename: string,
  meta: EvidenceMeta,
  type?: 'image/png' | 'image/jpeg',
  quality?: number,
): Promise<Produced | null> => {
  const fitted = await fitImageBlob(
    raster.canvas,
    raster.metresPerPx,
    type,
    quality,
  );
  if (!fitted) return null;
  return {
    blob: fitted.blob,
    filename,
    meta: {
      metresPerPx: fitted.metresPerPx,
      bbox25833: raster.bbox25833,
      ...meta,
    },
  };
};

export const renderEvidence = async (
  spec: BrowserSpec,
  bbox4326: Bbox,
  signal: AbortSignal,
): Promise<Produced | null> => {
  switch (spec.kind) {
    case 'lidar': {

      if (spec.style === CVAT_STYLE) {
        const acquisition = (await fetchCvatAcquisitions()).find(
          (a) => projectSourceKey(a.project.projectName) === spec.sourceKey,
        );

        if (!acquisition) return null;
        const raster = await fetchCvatRaster(bbox4326, acquisition, signal);
        if (!raster) return null;
        return produce(
          raster,
          `${sanitizeFilename(acquisition.project.projectName)}_${CVAT_STYLE}.png`,
          {
            year: acquisition.project.year,
            pointDensity: acquisition.project.pointDensity,
          },
        );
      }

      const sources = await enumerateLidarSources(bbox4326, spec.model);
      const source = sources.find((s) => s.key === spec.sourceKey);

      if (!source?.styles.includes(spec.style)) return null;
      const raster = await extractCanvas(
        bboxToMetric(bbox4326),
        source,
        spec.style,
        signal,
      );
      if (!raster) return null;
      return produce(
        raster,
        `${sanitizeFilename(source.label)}_${spec.style}.png`,
        { year: source.year, pointDensity: source.pointDensity },
      );
    }

    case 'terrain': {
      const dem = await fetchDem(bbox4326, {
        model: spec.model,
        signal,
        whole: true,
      });
      if (!dem) return null;

      const radius = clampRadius(spec.vis, dem, spec.radius);
      const staticField = terrainStaticField(dem, spec.vis, radius);
      const field = terrainField(
        dem,
        spec.vis,
        {
          azimuth: spec.azimuth,
          altitude: spec.altitude,
          zFactor: spec.zFactor,
        },
        staticField,
      );
      if (!field) return null;
      const canvas = paintTerrainField(field, dem, spec.vis);
      if (!canvas) return null;
      return produce(
        {
          canvas,
          metresPerPx: dem.metresPerPx,
          bbox25833: demImageExtent(dem),
        },
        `terreng_${spec.vis}_${spec.model}.png`,
        { radius },
      );
    }

    case 'flyfoto': {
      const project =
        spec.projectId === NIB_MOSAIC
          ? undefined
          : (await fetchFlyfotoProjectsForBbox(bbox4326, signal)).find(
              (p) => p.id === spec.projectId,
            );

      if (spec.projectId !== NIB_MOSAIC && !project) return null;
      const raster = await fetchFlyfotoRaster(bbox4326, { project, signal });
      if (!raster) return null;

      return produce(
        raster,
        `flyfoto_${sanitizeFilename(spec.projectId)}.jpg`,
        project
          ? {
              projectName: project.projectName,
              year: project.year,
              photoDate: project.photoDate,
            }
          : {},
        'image/jpeg',
        0.9,
      );
    }
  }
};
