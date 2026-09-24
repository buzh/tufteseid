import type { EvidenceMeta } from '../api/evidence';
import { extractCanvas } from '../lidarExtract/run';
import { enumerateLidarSources } from '../lidarExtract/sources';
import { bboxToMetric, type Bbox } from '../map/bbox';
import { fetchFlyfotoProjectsForBbox } from '../map/layers/config/backgroundLayers/flyfotoProjects';
import { fetchDem } from '../terrain/dem';
import {
  clampRadius,
  demImageExtent,
  paintTerrainField,
  terrainField,
  terrainStaticField,
} from '../terrain/render';
import { sanitizeFilename } from './filename';
import { fitImageBlob } from './fit';
import { fetchFlyfotoRaster } from './flyfotoRaster';
import { NIB_MOSAIC, type EvidenceSpec } from './spec';

/** The figure, and what making it revealed. `meta` is merged over the spec's
 *  own — never replacing it. */
export type Produced = {
  blob: Blob;
  filename: string;
  meta: EvidenceMeta;
};

/**
 * Null means the source has nothing over this rectangle: not a failure, and
 * nothing a retry would change. A throw is a fault. `queue.ts` tells the two
 * apart on exactly that.
 */
export const renderEvidence = async (
  spec: EvidenceSpec,
  bbox4326: Bbox,
  signal: AbortSignal,
): Promise<Produced | null> => {
  switch (spec.kind) {
    case 'lidar': {
      const sources = await enumerateLidarSources(bbox4326, spec.model);
      const source = sources.find((s) => s.key === spec.sourceKey);
      // Retired upstream, no longer covering this rectangle, or no longer
      // publishing this style — asking anyway answers 200 with a JSON body.
      if (!source?.styles.includes(spec.style)) return null;
      const raster = await extractCanvas(
        bboxToMetric(bbox4326),
        source,
        spec.style,
        signal,
      );
      if (!raster) return null;
      const fitted = await fitImageBlob(raster.canvas, raster.metresPerPx);
      if (!fitted) return null;
      return {
        blob: fitted.blob,
        filename: `${sanitizeFilename(source.label)}_${spec.style}.png`,
        meta: {
          metresPerPx: fitted.metresPerPx,
          bbox25833: raster.bbox25833,
          year: source.year,
          pointDensity: source.pointDensity,
        },
      };
    }

    case 'terrain': {
      const dem = await fetchDem(bbox4326, { model: spec.model, signal });
      if (!dem) return null;
      // Write the clamped radius back, or the duplicate guard never matches and
      // the button offers to make this same picture forever.
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
      const fitted = await fitImageBlob(canvas, dem.metresPerPx);
      if (!fitted) return null;
      return {
        blob: fitted.blob,
        filename: `terreng_${spec.vis}_${spec.model}.png`,
        meta: {
          // The file's, not the grid's: the store fit may have coarsened it.
          metresPerPx: fitted.metresPerPx,
          bbox25833: demImageExtent(dem),
          radius,
        },
      };
    }

    case 'flyfoto': {
      const project =
        spec.projectId === NIB_MOSAIC
          ? undefined
          : (await fetchFlyfotoProjectsForBbox(bbox4326, signal)).find(
              (p) => p.id === spec.projectId,
            );
      // Named an acquisition the catalogue no longer lists over this ground.
      if (spec.projectId !== NIB_MOSAIC && !project) return null;
      const raster = await fetchFlyfotoRaster(bbox4326, { project, signal });
      if (!raster) return null;
      // JPEG all the way through, like the stitch: a lossless copy of a
      // lossy-sourced photograph is several times the bytes for nothing.
      const fitted = await fitImageBlob(
        raster.canvas,
        raster.metresPerPx,
        'image/jpeg',
        0.9,
      );
      if (!fitted) return null;
      return {
        blob: fitted.blob,
        filename: `flyfoto_${sanitizeFilename(spec.projectId)}.jpg`,
        meta: {
          metresPerPx: fitted.metresPerPx,
          bbox25833: raster.bbox25833,
          ...(project
            ? {
                projectName: project.projectName,
                year: project.year,
                photoDate: project.photoDate,
              }
            : {}),
        },
      };
    }
  }
};
