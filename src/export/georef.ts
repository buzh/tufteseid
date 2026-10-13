import type { Metric } from '../map/bbox';

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

const WORLD_EXTENSIONS: Record<string, string> = { png: 'pgw', jpg: 'jgw' };

export const worldExtension = (extension: string): string =>
  WORLD_EXTENSIONS[extension] ?? 'wld';

const DECIMALS = 10;

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
