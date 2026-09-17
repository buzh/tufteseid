import { getUrlParameter } from '../../../../shared/utils/urlUtils';
import { halved } from '../../../compare/halves';
import { BackgroundLayerName } from '../../backgroundLayers';
import { WMSBackgroundLayer } from './types';

// What "Standard" can be: four cartographies out of Kartverket's cache plus
// amtskart, the pre-1917 series. Variants on one ground, so they ride the
// settings strip and the W/S ring like LiDAR datasets.
export const STANDARD_VARIANTS = [
  'topo',
  'topograatone',
  'toporaster',
  'sjokartraster',
  'amtskart',
] as const satisfies readonly BackgroundLayerName[];

export type StandardVariant = (typeof STANDARD_VARIANTS)[number];

const VARIANTS: ReadonlySet<string> = new Set(STANDARD_VARIANTS);

export const isStandardVariant = (name: string): name is StandardVariant =>
  VARIANTS.has(name);

/**
 * Amtskartserien (1:200 000), georeferenced and stitched. TRANSPARENT and in
 * NEEDS_TOPO_BASE: publication stopped around 1917, before Nordland.
 */
export const AMTSKART_CONFIG: WMSBackgroundLayer = {
  type: 'WMS',
  layerName: 'amtskart',
  url: '/wms/geonorge/wms.historiskekart',
  props: {
    // `amt1` is the seamless mosaic; the service's other layer, `georefererte`,
    // wants the id of one specific scanned map.
    LAYERS: 'amt1',
    TRANSPARENT: true,
    VERSION: '1.3.0',
  },
  // The layer's declared EPSG:25833 bounds; without it OL asks for open ocean.
  coverageExtent: {
    extent: [-127998, 6377920, 1145510, 7976800],
    crs: 'EPSG:25833',
  },
};

// Which variant Standard means, remembered while another ground is up. Seeded
// from ?backgroundLayer, the parameter the background atom reads, so the two
// cannot disagree on a cold load.
const initialVariant = (): StandardVariant => {
  const fromUrl = getUrlParameter('backgroundLayer');
  return fromUrl && isStandardVariant(fromUrl) ? fromUrl : 'topo';
};

export const standardVariantHalves = halved<StandardVariant>(initialVariant());
export const standardVariantAtom = standardVariantHalves.focused;
