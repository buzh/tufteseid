import { getUrlParameter } from '../../../../shared/utils/urlUtils';
import { halved } from '../../../compare/halves';
import { BackgroundLayerName } from '../../backgroundLayers';
import { VIEW_MAX_ZOOM } from '../../wmsTileGrid';
import { XYZBackgroundLayer } from './types';

// What "Kart" can be: four cartographies out of Kartverket's cache plus
// amtskart, the pre-1917 series. Variants on one ground, so they ride the
// settings strip and the W/S ring like LiDAR datasets.
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

/**
 * Amtskartserien (1:200 000), georeferenced and stitched. Transparent and in
 * NEEDS_TOPO_BASE: publication stopped around 1917, before Nordland.
 *
 * Read out of our MapProxy cache of wms.historiskekart's `amt1` — the heaviest
 * tile in the app at ~586 kB of scanned sheet, and the one where holding it
 * pays most. Which layer, and why not the service's `georefererte`, is in
 * mapproxy/mapproxy.yaml.
 */
export const AMTSKART_CONFIG: XYZBackgroundLayer = {
  type: 'XYZ',
  layerName: 'amtskart',
  url: '/cache/amtskart/{z}/{x}/{y}.png',
  projection: 'EPSG:25833',
  minZoom: 0,
  maxZoom: VIEW_MAX_ZOOM,
  // A miss is a GetMap upstream; see the field's own note in types.ts.
  preload: 0,
  sparse: false,
  // The layer's declared EPSG:25833 bounds; without it OL asks for open ocean.
  coverageExtent: {
    extent: [-127998, 6377920, 1145510, 7976800],
    crs: 'EPSG:25833',
  },
};

// Which variant Kart means, remembered while another ground is up. Seeded
// from ?backgroundLayer, the parameter the background atom reads, so the two
// cannot disagree on a cold load.
const initialVariant = (): KartVariant => {
  const fromUrl = getUrlParameter('backgroundLayer');
  return fromUrl && isKartVariant(fromUrl) ? fromUrl : 'topo';
};

export const kartVariantHalves = halved<KartVariant>(initialVariant());
export const kartVariantAtom = kartVariantHalves.focused;
