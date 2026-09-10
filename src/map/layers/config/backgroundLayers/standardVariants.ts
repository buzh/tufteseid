import { getUrlParameter } from '../../../../shared/utils/urlUtils';
import { halved } from '../../../compare/halves';
import { BackgroundLayerName } from '../../backgroundLayers';
import { WMSBackgroundLayer } from './types';

/*
 * What "Standard" can be.
 *
 * The mode used to mean exactly one layer — the topo WMTS — and the settings
 * strip was therefore absent for it, which is the one hole the strip had.
 * Kartverket publishes the same ground drawn four ways in the same cache, and
 * the differences are the kind an amateur reading terrain actually uses: grey
 * to put coloured marks on, the printed series' own cartography for the
 * old spellings and the paths it kept, the nautical chart for depths and
 * skerries along the shore.
 *
 * The fifth is not modern at all. Amtskart is a *ground* rather than a
 * historical curiosity: farm names, mills, ferry crossings, the road that is
 * now a track and the tract that has since been cleared, drawn before the
 * twentieth century rearranged them. Read against a hillshade of the same
 * hillside — one on each side of the compare curtain — it is one of the
 * better instruments in the app.
 *
 * Modelled as *variants of Standard* rather than as grounds of their own,
 * because there is no room in the ring for five more buttons and no reason
 * to make one: they answer the same question (an ordinary map, to know where
 * you are), so they belong on the strip and in the W/S ring, exactly like
 * LiDAR datasets and ortofoto acquisitions do. docs/ui-architecture.md §5.2.
 */
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
 * Amtskartserien (1:200 000), georeferenced and stitched, off the same
 * /wms/geonorge/* handler as everything else on wms.geonorge.no — the
 * handler passes the whole path through, so this needed no proxy change.
 *
 * TRANSPARENT because the series has a hole in it, and a big one: the first
 * sheet is from 1826 and publication stopped around 1917 before Nordland was
 * ever covered, which a GetMap probe confirms — Bodø and Mosjøen come back as
 * empty tiles while Narvik and Tromsø are drawn. That is why `amtskart` is in
 * NEEDS_TOPO_BASE: without a modern map under it, choosing this variant in
 * Nordland would look like the app had broken.
 */
export const AMTSKART_CONFIG: WMSBackgroundLayer = {
  type: 'WMS',
  layerName: 'amtskart',
  url: '/wms/geonorge/wms.historiskekart',
  props: {
    // The service's other layer, `georefererte`, wants the id of one specific
    // scanned map; `amt1` is the seamless mosaic of the whole series.
    LAYERS: 'amt1',
    TRANSPARENT: true,
    VERSION: '1.3.0',
  },
  // The layer's own declared EPSG:25833 bounds, same reason as every other
  // WMS here: without it OL asks this renderer for tiles over open ocean.
  coverageExtent: {
    extent: [-127998, 6377920, 1145510, 7976800],
    crs: 'EPSG:25833',
  },
};

// Which variant Standard means, remembered while you are on another ground so
// that 1 comes back to the map you left rather than resetting to topo — the
// same promise the LiDAR dataset and the ortofoto acquisition make. Halved
// like the rest of the background state, so the two sides of the compare
// curtain can be two different cartographies of the same ground.
//
// Seeded from ?backgroundLayer, which is the same parameter the background
// atom reads: the two must not disagree on a cold load into a shared link.
const initialVariant = (): StandardVariant => {
  const fromUrl = getUrlParameter('backgroundLayer');
  return fromUrl && isStandardVariant(fromUrl) ? fromUrl : 'topo';
};

export const standardVariantHalves = halved<StandardVariant>(initialVariant());
export const standardVariantAtom = standardVariantHalves.focused;
