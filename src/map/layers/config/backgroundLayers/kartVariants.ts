import { getUrlParameter } from '../../../../shared/utils/urlUtils';
import { halved } from '../../../compare/halves';
import { BackgroundLayerName } from '../../backgroundLayers';
import { VIEW_MAX_ZOOM } from '../../wmsTileGrid';
import { XYZBackgroundLayer } from './types';

export const KART_VARIANTS = [
  'topo',
  'topograatone',
  'toporaster',
  'sjokartraster',
  'amtskart',
] as const satisfies readonly BackgroundLayerName[];

export type KartVariant = (typeof KART_VARIANTS)[number];

const VARIANTS: ReadonlySet<string> = new Set(KART_VARIANTS);

export const isKartVariant = (name: string): name is KartVariant =>
  VARIANTS.has(name);

// Amtskartserien (1:200 000). Transparent, and in NEEDS_TOPO_BASE: the series
// stopped around 1917 and never covered Nordland.
export const AMTSKART_CONFIG: XYZBackgroundLayer = {
  type: 'XYZ',
  layerName: 'amtskart',
  url: '/cache/amtskart/{z}/{x}/{y}.png',
  projection: 'EPSG:25833',
  minZoom: 0,
  maxZoom: VIEW_MAX_ZOOM,
  preload: 0,
  sparse: false,
  // The layer's declared EPSG:25833 bounds.
  coverageExtent: {
    extent: [-127998, 6377920, 1145510, 7976800],
    crs: 'EPSG:25833',
  },
};

const initialVariant = (): KartVariant => {
  const fromUrl = getUrlParameter('backgroundLayer');
  return fromUrl && isKartVariant(fromUrl) ? fromUrl : 'topo';
};

export const kartVariantHalves = halved<KartVariant>(initialVariant());
