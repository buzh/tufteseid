// Spec → pixels. The one place a kept row becomes an image.
//
// A render is not a cache. Upstreams re-fly and reprocess, so the same spec
// re-rendered in three years may not be the picture its author read; the file
// is the citable artifact and `meta.renderedAt` says when it was made.
//
// Null means the source has nothing over this rectangle, which is not a
// failure and offers nothing to retry. A throw is a fault.

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

// Filenames end up in a download dialog, so keep them to something a filesystem
// and a URL both accept.
const sanitizeFilename = (s: string) =>
  s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || 'bilde';

export const renderEvidence = async (
  spec: EvidenceSpec,
  bbox4326: Bbox,
  signal: AbortSignal,
): Promise<Produced | null> => {
  switch (spec.kind) {
    case 'lidar': {
      // The catalogue rather than the stored key alone: the key is a name, and
      // what the stitch needs is the URL, the layer prefix and the published
      // style list.
      const sources = await enumerateLidarSources(bbox4326, spec.model);
      const source = sources.find((s) => s.key === spec.sourceKey);
      // Retired upstream, or no longer covering this rectangle.
      if (!source) return null;
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
          // Resolved here and gone by the time anyone reads the card; a row
          // kept before the catalogue knew them gets them filled in by its
          // first render.
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
          // Off the window's pixel offsets, so the rectangle named is the one
          // the pixels cover to within nothing.
          bbox25833: demImageExtent(dem),
          // What the finest covering acquisition publishes. The gap between
          // this and `metresPerPx` is the difference between a reading of the
          // ground and a reading of an average of it.
          nativeMetresPerPx: dem.nativeMetresPerPx,
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
      // JPEG all the way through, like the stitch itself: a lossless copy of a
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
                projectMetresPerPx: project.metresPerPx,
              }
            : {}),
        },
      };
    }
  }
};
