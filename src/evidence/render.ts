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
import { fetchDem } from '../terrain/dem';
import {
  clampRadius,
  demImageExtent,
  paintTerrainField,
  terrainField,
  terrainStaticField,
} from '../terrain/render';
import { fetchCvatRaster } from './cvatRaster';
import { sanitizeFilename } from './filename';
import { fitImageBlob } from './fit';
import { fetchFlyfotoRaster } from './flyfotoRaster';
import { NIB_MOSAIC, type EvidenceSpec } from './spec';

/** `meta` is merged over the spec's own — never replacing it. */
type Produced = {
  blob: Blob;
  filename: string;
  meta: EvidenceMeta;
};

/** Everything but `sunloop`, which the sidecar renders. Stated as a type so the
 *  switch below stays exhaustive and the compiler refuses a loop here. */
type BrowserSpec = Exclude<EvidenceSpec, { kind: 'sunloop' }>;

/**
 * Null means the source has nothing over this rectangle: an answer about the
 * ground rather than a fault. A throw is a fault. `queue.ts` tells the two
 * apart on exactly that, and offers a retry either way.
 */
export const renderEvidence = async (
  spec: BrowserSpec,
  bbox4326: Bbox,
  signal: AbortSignal,
): Promise<Produced | null> => {
  switch (spec.kind) {
    case 'lidar': {
      // The cached VAT is the one style with no service behind it: the pixels
      // are in our own store, keyed by the same flight the WMS publishes.
      if (spec.style === CVAT_STYLE) {
        const acquisition = (await fetchCvatAcquisitions()).find(
          (a) => projectSourceKey(a.project.projectName) === spec.sourceKey,
        );
        // Dropped from the store since, or never in it.
        if (!acquisition) return null;
        const raster = await fetchCvatRaster(bbox4326, acquisition, signal);
        if (!raster) return null;
        const fitted = await fitImageBlob(raster.canvas, raster.metresPerPx);
        if (!fitted) return null;
        return {
          blob: fitted.blob,
          filename: `${sanitizeFilename(acquisition.project.projectName)}_${CVAT_STYLE}.png`,
          meta: {
            metresPerPx: fitted.metresPerPx,
            bbox25833: raster.bbox25833,
            year: acquisition.project.year,
            pointDensity: acquisition.project.pointDensity,
          },
        };
      }

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
