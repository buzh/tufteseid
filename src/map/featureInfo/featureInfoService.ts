import { Coordinate } from 'ol/coordinate';
import BaseLayer from 'ol/layer/Base';
import ImageLayer from 'ol/layer/Image';
import Layer from 'ol/layer/Layer';
import TileLayer from 'ol/layer/Tile';
// Aliased: OpenLayers' `Map` would shadow the global one the memo below uses.
import type OLMap from 'ol/Map';
import { ImageWMS, TileWMS } from 'ol/source';
import { fetchWithin } from '../../shared/utils/deadline';
import type { FieldConfig } from '../layers/themeLayerConfigApi';
import type {
  FeatureInfoFeature,
  FeatureProperties,
  InfoFormat,
  LayerFeatureInfo,
} from './types';
import { DEFAULT_INFO_FORMAT } from './types';

export type QueryableWMSLayer = TileLayer | ImageLayer<ImageWMS>;

// Not `getVisible()`, which is only the checkbox: a layer with `minZoom: 8`
// still reports visible below it. `isVisible` folds in the zoom, resolution and
// extent limits.
const isRendering = (layer: BaseLayer, map: OLMap): boolean =>
  layer instanceof Layer && layer.isVisible(map.getView());

/** The WMS layers a click can be put to: queryable, drawing at this zoom, and
 *  among `ids`. */
export const getQueryableWMSLayers = (
  map: OLMap,
  ids: ReadonlySet<string>,
): QueryableWMSLayer[] => {
  return map
    .getLayers()
    .getArray()
    .filter((layer): layer is QueryableWMSLayer => {
      const isTileWMS =
        layer instanceof TileLayer && layer.getSource() instanceof TileWMS;
      const isImageWMS =
        layer instanceof ImageLayer && layer.getSource() instanceof ImageWMS;
      if (!isTileWMS && !isImageWMS) return false;

      const id = layer.get('id');
      const isQueryable = layer.get('queryable') === true;

      return (
        typeof id === 'string' &&
        ids.has(id) &&
        isQueryable &&
        isRendering(layer, map)
      );
    });
};

const buildFeatureInfoUrl = (
  layer: QueryableWMSLayer,
  coordinate: Coordinate,
  map: OLMap,
  infoFormat: InfoFormat = DEFAULT_INFO_FORMAT,
): string | null => {
  const source = layer.getSource();
  if (!(source instanceof TileWMS) && !(source instanceof ImageWMS))
    return null;

  const view = map.getView();
  const resolution = view.getResolution();
  const projection = view.getProjection();

  if (!resolution) return null;

  const url = source.getFeatureInfoUrl(coordinate, resolution, projection, {
    INFO_FORMAT: infoFormat,
    FEATURE_COUNT: 10,
  });

  return url || null;
};

const parseJsonFeatureInfo = (data: unknown): FeatureInfoFeature[] => {
  if (!data || typeof data !== 'object') return [];

  if (
    'features' in data &&
    Array.isArray((data as { features: unknown }).features)
  ) {
    const fc = data as {
      features: Array<{ id?: string; properties?: FeatureProperties }>;
    };
    return fc.features.map((f) => ({
      id: f.id?.toString(),
      properties: f.properties || {},
    }));
  }

  if ('properties' in data) {
    const feature = data as { id?: string; properties?: FeatureProperties };
    return [
      {
        id: feature.id?.toString(),
        properties: feature.properties || {},
      },
    ];
  }

  if (typeof data === 'object' && data !== null) {
    return [{ properties: data as FeatureProperties }];
  }

  return [];
};

const parsePlainTextFeatureInfo = (text: string): FeatureInfoFeature[] => {
  if (!text || text.trim() === '') return [];

  const noFeaturesPatterns = [
    'no features were found',
    'search returned no results',
    'no results',
    'ingen treff',
  ];
  const lowerText = text.toLowerCase();
  if (noFeaturesPatterns.some((p) => lowerText.includes(p))) {
    return [];
  }

  const features: FeatureInfoFeature[] = [];

  const lines = text.split('\n');
  const properties: FeatureProperties = {};
  let currentKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(.+?)\s*[=:]\s*(.+)$/);

    if (match) {
      const key = match[1].trim();
      currentKey = key;

      const value = match[2].trim().replace(/^['"]|['"]$/g, '');

      const numValue = parseFloat(value);
      if (!isNaN(numValue) && value === numValue.toString()) {
        properties[key] = numValue;
      } else {
        properties[key] = value;
      }

      continue;
    }

    if (currentKey) {
      properties[currentKey] = String(properties[currentKey]) + '\n' + trimmed;
    }
  }

  if (Object.keys(properties).length > 0) {
    features.push({ properties });
  }

  return features;
};

const parseXmlFeatureInfo = (text: string): FeatureInfoFeature[] => {
  if (!text || text.trim() === '') return [];

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      console.warn('XML parse error:', parseError.textContent);
      return [];
    }

    const features: FeatureInfoFeature[] = [];

    const msGMLOutput = doc.querySelector('msGMLOutput');
    if (msGMLOutput) {
      const layerElements = Array.from(msGMLOutput.children).filter((el) =>
        el.localName.endsWith('_layer'),
      );

      for (const layerElement of layerElements) {
        const featureElements = Array.from(layerElement.children).filter((el) =>
          el.localName.endsWith('_feature'),
        );

        for (const featureElement of featureElements) {
          const properties: FeatureProperties = {};

          for (const child of Array.from(featureElement.children)) {
            if (
              child.localName.toLowerCase().includes('geom') ||
              child.localName.toLowerCase() === 'the_geom' ||
              child.localName.toLowerCase() === 'shape' ||
              child.localName.toLowerCase() === 'posisjon' ||
              child.localName === 'boundedBy' ||
              child.namespaceURI === 'http://www.opengis.net/gml'
            ) {
              continue;
            }

            if (child.textContent) {
              const value = child.textContent.trim();
              if (value === '') continue;

              const numValue = parseFloat(value);
              if (!isNaN(numValue) && value === numValue.toString()) {
                properties[child.localName] = numValue;
              } else {
                properties[child.localName] = value;
              }
            }
          }

          if (Object.keys(properties).length > 0) {
            features.push({ properties });
          }
        }
      }

      return features;
    }

    const featureMembers = doc.querySelectorAll(
      'featureMember, gml\\:featureMember, featureMembers > *',
    );

    if (featureMembers.length === 0) {
      const root = doc.documentElement;
      const properties: FeatureProperties = {};

      for (const child of Array.from(root.children)) {
        if (child.children.length === 0 && child.textContent) {
          properties[child.localName] = child.textContent.trim();
        }
      }

      if (Object.keys(properties).length > 0) {
        features.push({ properties });
      }
    } else {
      featureMembers.forEach((member) => {
        const properties: FeatureProperties = {};
        const featureElement = member.children[0] || member;

        for (const child of Array.from(featureElement.children)) {
          if (
            child.localName.toLowerCase().includes('geom') ||
            child.localName.toLowerCase() === 'the_geom' ||
            child.localName.toLowerCase() === 'shape'
          ) {
            continue;
          }

          if (child.textContent) {
            const value = child.textContent.trim();
            const numValue = parseFloat(value);
            if (!isNaN(numValue) && value === numValue.toString()) {
              properties[child.localName] = numValue;
            } else {
              properties[child.localName] = value;
            }
          }
        }

        if (Object.keys(properties).length > 0) {
          const fid =
            featureElement.getAttribute('fid') ||
            featureElement.getAttribute('gml:id');
          features.push({
            id: fid || undefined,
            properties,
          });
        }
      });
    }

    return features;
  } catch (error) {
    console.warn('Failed to parse XML feature info:', error);
    return [];
  }
};

const parseHtmlFeatureInfo = (html: string): FeatureInfoFeature[] => {
  if (!html || html.trim() === '') return [];

  const lowerHtml = html.toLowerCase();
  if (
    lowerHtml.includes('no features') ||
    lowerHtml.includes('ingen treff') ||
    html.trim() === '<html></html>' ||
    html.trim() === ''
  ) {
    return [];
  }

  return [
    {
      properties: {
        _html: html,
      },
    },
  ];
};

const parseFeatureInfo = (
  data: string | object,
  contentType: string,
): FeatureInfoFeature[] => {
  const lowerContentType = contentType.toLowerCase();

  if (lowerContentType.includes('json')) {
    const jsonData = typeof data === 'string' ? JSON.parse(data) : data;
    return parseJsonFeatureInfo(jsonData);
  }

  if (lowerContentType.includes('html')) {
    return parseHtmlFeatureInfo(data as string);
  }

  if (lowerContentType.includes('xml') || lowerContentType.includes('gml')) {
    return parseXmlFeatureInfo(data as string);
  }

  if (lowerContentType.includes('plain')) {
    return parsePlainTextFeatureInfo(data as string);
  }

  if (typeof data === 'string') {
    try {
      const jsonData = JSON.parse(data);
      return parseJsonFeatureInfo(jsonData);
    } catch {
      return parsePlainTextFeatureInfo(data);
    }
  }

  return parseJsonFeatureInfo(data);
};

// Keyed by the GetFeatureInfo URL, which carries the sublayers, styles, tile
// bbox and pixel, so nothing needs invalidating. Eviction is by age, not use: a
// `Map` iterates in insertion order.
const MEMO_LIMIT = 400;
const memo = new Map<string, FeatureInfoFeature[]>();

const remember = (key: string, features: FeatureInfoFeature[]) => {
  if (memo.size >= MEMO_LIMIT) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  memo.set(key, features);
};

/** Well under wmscache's 30 s read timeout. */
const FEATURE_INFO_DEADLINE_MS = 12_000;

export const fetchLayerFeatureInfo = async (
  layer: QueryableWMSLayer,
  coordinate: Coordinate,
  map: OLMap,
  signal?: AbortSignal,
): Promise<LayerFeatureInfo> => {
  const layerId = layer.get('id') as string;
  const layerTitle =
    (layer.get('layerTitle') as string) || layerId.replace('theme.', '');

  const preferredFormat = layer.get('infoFormat') as InfoFormat | undefined;
  const imageBaseUrl = layer.get('featureInfoImageBaseUrl') as
    string | undefined;
  const fieldConfigs = layer.get('featureInfoFields') as
    FieldConfig[] | undefined;

  const answer = (
    features: FeatureInfoFeature[],
    error?: string,
  ): LayerFeatureInfo => ({
    layerId,
    layerTitle,
    features,
    ...(error ? { error } : {}),
    ...(imageBaseUrl ? { imageBaseUrl } : {}),
    ...(fieldConfigs ? { fieldConfigs } : {}),
  });

  const formatsToTry: InfoFormat[] = preferredFormat
    ? [preferredFormat]
    : ['application/json', 'application/vnd.ogc.gml', 'text/xml', 'text/plain'];

  // The first format's URL is the memo key whichever format answers: they
  // differ only in `INFO_FORMAT`.
  const key = buildFeatureInfoUrl(layer, coordinate, map, formatsToTry[0]);
  if (!key) return answer([], 'Could not build GetFeatureInfo URL');
  const remembered = memo.get(key);
  if (remembered) return answer(remembered);

  // An empty answer is worth remembering, but only when every format was
  // actually asked: a failed request would otherwise cache a hole.
  let failed = false;

  for (const format of formatsToTry) {
    const url = buildFeatureInfoUrl(layer, coordinate, map, format);
    if (!url) return answer([], 'Could not build GetFeatureInfo URL');

    try {
      // `fetchWithin`, not `fetch`: a non-tile request to an external origin is
      // the breaker's to admit or refuse.
      const { contentType, data } = await fetchWithin(
        url,
        {
          ms: FEATURE_INFO_DEADLINE_MS,
          what: `GetFeatureInfo ${layerId}`,
          signal,
        },
        async (res) => {
          const contentType = res.headers.get('content-type') || format;
          return {
            contentType,
            data: contentType.includes('json')
              ? ((await res.json()) as object)
              : await res.text(),
          };
        },
      );

      const features = parseFeatureInfo(data, contentType);

      if (features.length > 0) {
        remember(key, features);
        return answer(features);
      }

      // JSON is structured enough that an empty answer is the answer; the text
      // formats are not, so a parse that found nothing tries the next one.
      if (contentType.includes('json')) {
        remember(key, features);
        return answer(features);
      }
    } catch (error) {
      failed = true;
      if (signal?.aborted) throw error;
      console.warn(
        `Failed to fetch feature info with format ${format}:`,
        error,
      );
    }
  }

  if (!failed) remember(key, []);
  return answer([]);
};
