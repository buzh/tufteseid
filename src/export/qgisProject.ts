// The bundle's QGIS project: every picture placed and stacked, the public
// upstreams wired in, nothing for the reader to configure.
//
// Written against what QGIS 4.2 itself saves, element for element, rather
// than from the format's documentation — `QGIS_VERSION` below is part of that
// coupling and is not a minimum (`docs/architecture.md`).

import type { Metric } from '../map/bbox';

const QGIS_VERSION = '4.2.2-Belém do Pará';

/** Rough mainland-plus-Svalbard bounds, so *Zoom to layer* on a service means
 *  something. Nothing renders off it. */
const NORWAY_25833: Metric = [-200000, 6400000, 1400000, 9100000];

/** How much ground the view opens with around the footprint. */
const CANVAS_MARGIN = 0.15;

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const SRS_25833 =
  '<spatialrefsys nativeFormat="Wkt">' +
  '<wkt>PROJCRS["ETRS89 / UTM zone 33N",BASEGEOGCRS["ETRS89",DATUM["European Terrestrial Reference System 1989",ELLIPSOID["GRS 1980",6378137,298.257222101,LENGTHUNIT["metre",1]]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],ID["EPSG",4258]],CONVERSION["UTM zone 33N",METHOD["Transverse Mercator",ID["EPSG",9807]],PARAMETER["Latitude of natural origin",0,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8801]],PARAMETER["Longitude of natural origin",15,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8802]],PARAMETER["Scale factor at natural origin",0.9996,SCALEUNIT["unity",1],ID["EPSG",8805]],PARAMETER["False easting",500000,LENGTHUNIT["metre",1],ID["EPSG",8806]],PARAMETER["False northing",0,LENGTHUNIT["metre",1],ID["EPSG",8807]]],CS[Cartesian,2],AXIS["(E)",east,ORDER[1],LENGTHUNIT["metre",1]],AXIS["(N)",north,ORDER[2],LENGTHUNIT["metre",1]],ID["EPSG",25833]]</wkt>' +
  '<proj4>+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs</proj4>' +
  '<srsid>2106</srsid><srid>25833</srid><authid>EPSG:25833</authid>' +
  '<description>ETRS89 / UTM zone 33N</description>' +
  '<projectionacronym>utm</projectionacronym>' +
  '<ellipsoidacronym>EPSG:7019</ellipsoidacronym>' +
  '<geographicflag>false</geographicflag>' +
  '</spatialrefsys>';

/**
 * QGIS writes a bare `styles` for one layer and an empty `styles=` per layer
 * beyond that; both forms are copied from its own output rather than derived.
 */
const wmsSource = (url: string, layers: readonly string[]): string =>
  [
    'contextualWMSLegend=0',
    'crs=EPSG%3A25833',
    'dpiMode=7',
    'featureCount=10',
    'format=image%2Fpng',
    ...layers.map((layer) => `layers=${encodeURIComponent(layer)}`),
    layers.length === 1 ? 'styles' : layers.map(() => 'styles=').join('&'),
    'tilePixelRatio=0',
    `url=${encodeURIComponent(url)}`,
  ].join('&');

/**
 * The services a bundle wires up. These are the **public upstreams**, not this
 * installation's `/wms/…` paths: a bundle travels, and QGIS sits outside the
 * app's tile guard and circuit breaker. Change a host here and
 * `nginx/wms-cache.conf` holds the same one for the SPA's own path.
 *
 * `over` stands above the pictures — marks and names belong on top of the
 * ground; `under` is context around a footprint that is at most 500 m wide,
 * and within a stack the array order is the drawing order.
 *
 * Flyfoto is deliberately absent: it is reachable only through `nib-proxy`'s
 * injected token and is not open data (`docs/architecture.md`).
 */
const SERVICES = [
  // The app's own reference overlay: roads and names on transparency, for
  // reading over a render. It draws no ground, so it is not a basemap and
  // cannot be the thing that places a bundle — `topo` below is.
  {
    name: 'Topografisk referanse',
    url: 'https://wms.geonorge.no/skwms1/wms.topo',
    layers: [
      'fkb_samferdsel',
      'fkb_presentasjonsdata',
      'kd_stedsnavn',
      'kd_veger',
      'kd_jernbane',
    ],
    stack: 'over',
    checked: false,
  },
  {
    name: 'Kulturminner',
    url: 'https://kart.ra.no/wms/kulturminner2',
    layers: ['Kulturminner'],
    stack: 'over',
    checked: false,
  },
  // Relief rather than cartography, so it stands over the map below it.
  {
    name: 'Skyggerelieff (nasjonal)',
    url: 'https://wms.geonorge.no/skwms1/wms.hoyde-dtm-nhm-25833',
    layers: ['NHM_DTM_25833:skyggerelieff'],
    stack: 'under',
    checked: false,
  },
  // The one service on by default, and the bottom of the stack. A footprint
  // is at most 500 m across, so without ground under it a bundle opens as
  // pictures floating on nothing — no coastline, no water, no telling where
  // in the country you are.
  {
    name: 'Topografisk norgeskart',
    url: 'https://wms.geonorge.no/skwms1/wms.topo',
    layers: ['topo'],
    stack: 'under',
    checked: true,
  },
] as const;

const MIN_MAX_ORIGIN =
  '<minMaxOrigin><limits>None</limits><extent>WholeRaster</extent>' +
  '<statAccuracy>Estimated</statAccuracy>' +
  '<cumulativeCutLower>0.02</cumulativeCutLower>' +
  '<cumulativeCutUpper>0.98</cumulativeCutUpper>' +
  '<stdDevFactor>2</stdDevFactor></minMaxOrigin>';

// 8-bit channels straight through: these are pictures, not measurements, so
// nothing is stretched. PNG carries alpha and JPEG does not — true of the
// sidecar's renders as much as the ones made in the tab.
const bandEnhancement = (channel: string): string =>
  `<${channel}ContrastEnhancement><minValue>0</minValue>` +
  `<maxValue>255</maxValue><algorithm>NoEnhancement</algorithm>` +
  `</${channel}ContrastEnhancement>`;

const fileRenderer = (alpha: boolean): string =>
  `<rasterrenderer alphaBand="${alpha ? 4 : -1}" blueBand="3" greenBand="2" ` +
  'nodataColor="" opacity="1" redBand="1" type="multibandcolor">' +
  '<rasterTransparency/>' +
  MIN_MAX_ORIGIN +
  bandEnhancement('red') +
  bandEnhancement('green') +
  bandEnhancement('blue') +
  '</rasterrenderer>';

const SERVICE_RENDERER =
  '<rasterrenderer alphaBand="-1" band="1" nodataColor="" opacity="1" ' +
  'type="singlebandcolordata"><rasterTransparency/>' +
  MIN_MAX_ORIGIN +
  '</rasterrenderer>';

const pipe = (renderer: string): string =>
  '<pipe><provider><resampling enabled="false" maxOversampling="2" ' +
  'zoomedInResamplingMethod="nearestNeighbour" ' +
  'zoomedOutResamplingMethod="nearestNeighbour"/></provider>' +
  renderer +
  '<brightnesscontrast brightness="0" contrast="0" gamma="1"/>' +
  '<huesaturation colorizeBlue="128" colorizeGreen="128" colorizeOn="0" ' +
  'colorizeRed="255" colorizeStrength="100" grayscaleMode="0" ' +
  'invertColors="0" saturation="0"/>' +
  '<rasterresampler maxOversampling="2"/>' +
  '<resamplingStage>resamplingFilter</resamplingStage></pipe>';

const extentXml = ([minX, minY, maxX, maxY]: Metric): string =>
  `<extent><xmin>${minX}</xmin><ymin>${minY}</ymin>` +
  `<xmax>${maxX}</xmax><ymax>${maxY}</ymax></extent>`;

type Layer = {
  id: string;
  name: string;
  /** The `<datasource>` element and the tree's `source` attribute alike. */
  source: string;
  provider: 'gdal' | 'wms';
  extent: Metric;
  checked: boolean;
  renderer: string;
};

// QGIS's own shape: the name with everything but word characters replaced,
// then a UUID with its dashes likewise. Regenerated per bundle, so two spots'
// projects opened together cannot collide.
const layerId = (name: string): string =>
  `${name.replace(/[^A-Za-z0-9_]/g, '_')}_${crypto
    .randomUUID()
    .replace(/-/g, '_')}`;

const mapLayer = (layer: Layer): string =>
  '<maplayer autoRefreshMode="Disabled" autoRefreshTime="0" ' +
  'hasScaleBasedVisibilityFlag="0" layerType="Raster" ' +
  'legendPlaceholderImage="" maxScale="0" minScale="1e+08" ' +
  'refreshOnNotifyEnabled="0" refreshOnNotifyMessage="" ' +
  'styleCategories="AllStyleCategories" type="raster">' +
  extentXml(layer.extent) +
  `<id>${esc(layer.id)}</id>` +
  `<datasource>${esc(layer.source)}</datasource>` +
  `<layername>${esc(layer.name)}</layername>` +
  `<srs>${SRS_25833}</srs>` +
  `<provider>${layer.provider}</provider>` +
  pipe(layer.renderer) +
  '<blendMode>0</blendMode><legend/></maplayer>';

const treeEntry = (layer: Layer): string =>
  `<layer-tree-layer checked="Qt::${layer.checked ? 'Checked' : 'Unchecked'}" ` +
  `expanded="1" id="${esc(layer.id)}" legend_exp="" legend_split_behavior="0" ` +
  `name="${esc(layer.name)}" patch_size="-1,-1" ` +
  `providerKey="${layer.provider}" source="${esc(layer.source)}">` +
  '<customproperties><Option/></customproperties></layer-tree-layer>';

// The pre-tree mirror QGIS still writes. Cheap to emit and cheaper than
// finding out which readers want it.
const legendEntry = (layer: Layer): string =>
  `<legendlayer checked="Qt::${layer.checked ? 'Checked' : 'Unchecked'}" ` +
  `drawingOrder="-1" name="${esc(layer.name)}" open="true" ` +
  'showFeatureCount="0"><filegroup hidden="false" open="true">' +
  `<legendlayerfile isInOverview="0" layerid="${esc(layer.id)}" ` +
  `visible="${layer.checked ? 1 : 0}"/></filegroup></legendlayer>`;

const grown = ([minX, minY, maxX, maxY]: Metric): Metric => {
  const padX = (maxX - minX) * CANVAS_MARGIN;
  const padY = (maxY - minY) * CANVAS_MARGIN;
  return [minX - padX, minY - padY, maxX + padX, maxY + padY];
};

/** One picture as the project should carry it. */
export type ProjectRaster = {
  /** Layer name, and the file's own stem. */
  name: string;
  /** Path relative to the project file, forward slashes. */
  path: string;
  bbox25833: Metric;
  /** PNG carries an alpha band, JPEG does not. */
  alpha: boolean;
};

const serviceLayers = (stack: 'over' | 'under'): Layer[] =>
  SERVICES.filter((service) => service.stack === stack).map((service) => ({
    id: layerId(service.name),
    name: service.name,
    source: wmsSource(service.url, service.layers),
    provider: 'wms',
    extent: NORWAY_25833,
    checked: service.checked,
    renderer: SERVICE_RENDERER,
  }));

/**
 * `rasters` is the gallery's order, cover first, and that is the order they
 * stack in: the cover on top, each one unticked revealing the reading beneath
 * it. The whole point of the footprint is that they are all registered to one
 * another, so a stack is how they are meant to be read.
 */
export const qgisProject = (
  title: string,
  rasters: readonly ProjectRaster[],
  footprint: Metric | null,
): string => {
  const pictures: Layer[] = rasters.map((raster) => ({
    id: layerId(raster.name),
    name: raster.name,
    source: raster.path,
    provider: 'gdal',
    extent: raster.bbox25833,
    checked: true,
    renderer: fileRenderer(raster.alpha),
  }));

  const layers = [
    ...serviceLayers('over'),
    ...pictures,
    ...serviceLayers('under'),
  ];

  const canvas = grown(footprint ?? rasters[0]?.bbox25833 ?? NORWAY_25833);

  return (
    "<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>\n" +
    `<qgis projectname="${esc(title)}" version="${esc(QGIS_VERSION)}">` +
    '<homePath path=""/>' +
    `<title>${esc(title)}</title>` +
    `<projectCrs>${SRS_25833}</projectCrs>` +
    '<layer-tree-group><customproperties><Option/></customproperties>' +
    layers.map(treeEntry).join('') +
    '</layer-tree-group>' +
    '<mapcanvas annotationsVisible="1" name="theMapCanvas">' +
    '<units>meters</units>' +
    extentXml(canvas) +
    `<destinationsrs>${SRS_25833}</destinationsrs>` +
    '</mapcanvas>' +
    `<projectlayers>${layers.map(mapLayer).join('')}</projectlayers>` +
    '<layerorder>' +
    layers.map((layer) => `<layer id="${esc(layer.id)}"/>`).join('') +
    '</layerorder>' +
    '<legend updateDrawingOrder="true">' +
    layers.map(legendEntry).join('') +
    '</legend>' +
    '<properties name="properties"><properties name="Paths">' +
    '<properties name="Absolute" type="bool">false</properties>' +
    '</properties><properties name="SpatialRefSys">' +
    '<properties name="ProjectionsEnabled" type="int">1</properties>' +
    '</properties></properties>' +
    '</qgis>\n'
  );
};
