// What makes a bare raster land in the right place: a world file for the
// ground it covers and a `.prj` for the projection that ground is stated in.

import type { Metric } from '../map/bbox';

/** Every stored render records its ground in EPSG:25833 (`meta.bbox25833`), so
 *  that is what a bundle is written in. */
export const EXPORT_CRS = 'EPSG:25833';

export const CRS_WKT =
  'PROJCS["ETRS89 / UTM zone 33N",' +
  'GEOGCS["ETRS89",' +
  'DATUM["European_Terrestrial_Reference_System_1989",' +
  'SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],' +
  'AUTHORITY["EPSG","6258"]],' +
  'PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],' +
  'UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],' +
  'AUTHORITY["EPSG","4258"]],' +
  'PROJECTION["Transverse_Mercator"],' +
  'PARAMETER["latitude_of_origin",0],' +
  'PARAMETER["central_meridian",15],' +
  'PARAMETER["scale_factor",0.9996],' +
  'PARAMETER["false_easting",500000],' +
  'PARAMETER["false_northing",0],' +
  'UNIT["metre",1,AUTHORITY["EPSG","9001"]],' +
  'AXIS["Easting",EAST],AXIS["Northing",NORTH],' +
  'AUTHORITY["EPSG","25833"]]\n';

/** The sidecar GDAL looks for beside each raster type. `.wld` is read for any
 *  of them, but a reader opening the folder expects the specific one. */
const WORLD_EXTENSIONS: Record<string, string> = { png: 'pgw', jpg: 'jgw' };

export const worldExtension = (extension: string): string =>
  WORLD_EXTENSIONS[extension] ?? 'wld';

// Enough for a millimetre at UTM 33 eastings, which run to seven figures.
const DECIMALS = 10;

/**
 * Six lines: pixel width, two rotation terms, pixel height negated because
 * image rows run down and northings run up, then the **centre** of the
 * top-left pixel rather than its corner.
 *
 * The pixel size is measured off the decoded image, never `meta.metresPerPx`:
 * that figure is what the producer aimed at and the fit may have coarsened it
 * (`src/evidence/fit.ts`). `src/evidence/download.ts` measures its scale bar
 * the same way and for the same reason.
 */
export const worldFile = (
  bbox25833: Metric,
  widthPx: number,
  heightPx: number,
): string | null => {
  const [minX, minY, maxX, maxY] = bbox25833;
  if (!(widthPx > 0) || !(heightPx > 0)) return null;
  const xRes = (maxX - minX) / widthPx;
  const yRes = (maxY - minY) / heightPx;
  if (!(xRes > 0) || !(yRes > 0)) return null;
  return (
    [xRes, 0, 0, -yRes, minX + xRes / 2, maxY - yRes / 2]
      .map((n) => n.toFixed(DECIMALS))
      .join('\n') + '\n'
  );
};
