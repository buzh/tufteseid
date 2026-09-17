import { getDefaultStore } from 'jotai';
import { Feature } from 'ol';
import { createEmpty, extend } from 'ol/extent';
import { Point } from 'ol/geom';
import VectorLayer from 'ol/layer/Vector';
import Map from 'ol/Map';
import Cluster from 'ol/source/Cluster';
import VectorSource from 'ol/source/Vector';
import { getMarkerLayer } from '../../map/vectorLayers';
import { mapAtom } from '../../map/atoms';
import { fitPadding } from '../../shell/chromeInsets';
import { SearchResult } from '../../types/searchTypes';
import { clusterStyle } from './cluster';
import { createMarker } from './marker';
import { clusterPopup } from './popup';

const handleMarkerClick = (
  feature: Feature,
  onResultClick: (res: SearchResult) => void,
) => {
  const res = feature.get('searchResult');
  if (res) {
    onResultClick(res);
  }
};

const handleClusterClick = (
  clusterFeatures: Feature[],
  map: Map,
  onResultClick: (res: SearchResult) => void,
) => {
  const results = clusterFeatures.map(
    (f) => f.get('searchResult') as SearchResult,
  );
  const view = map.getView();
  const currentZoom = view.getZoom() || 0;
  const maxZoom = view.getMaxZoom();
  const minZoom = Math.min(currentZoom + 2, maxZoom);

  if (currentZoom === maxZoom) {
    const clusterGeometry = clusterFeatures[0].getGeometry();
    if (clusterGeometry && clusterGeometry instanceof Point) {
      const coordinates = clusterGeometry.getCoordinates();
      clusterPopup(results, map, coordinates, onResultClick);
    }
  } else {
    const extent = createEmpty();
    clusterFeatures.forEach((clusterFeature: Feature) => {
      const geometry = clusterFeature.getGeometry();
      if (geometry) {
        extend(extent, geometry.getExtent());
      }
    });
    view.fit(extent, {
      duration: 500,
      padding: fitPadding(map),
      maxZoom: minZoom,
    });
  }
};

// Built once: this runs on every hover over a result row, and a fresh Cluster
// re-clusters the whole set. Read back off the layer rather than held in a
// module variable, so it heals if the layer is re-sourced elsewhere.
const getMarkerSource = (markerLayer: VectorLayer): VectorSource => {
  const existing = markerLayer.getSource();
  if (existing instanceof Cluster) {
    return existing.getSource() as VectorSource;
  }
  const source = new VectorSource();
  markerLayer.setSource(new Cluster({ distance: 40, source }));
  return source;
};

// The handler is registered once and outlives any render, so it reads this at
// click time rather than closing over the callback current at registration.
let onMarkerResultClick: (res: SearchResult) => void = () => {};

const registerMarkerClickHandler = (map: Map) => {
  if (map.get('markerClickHandler')) return;
  map.set('markerClickHandler', true);
  map.on('singleclick', (evt) => {
    map.forEachFeatureAtPixel(
      evt.pixel,
      (feature) => {
        const featuresAtPixel = feature.get('features') as
          Feature[] | undefined;
        if (!featuresAtPixel?.length) {
          return false;
        }

        if (featuresAtPixel.length === 1) {
          handleMarkerClick(featuresAtPixel[0], onMarkerResultClick);
        } else {
          handleClusterClick(featuresAtPixel, map, onMarkerResultClick);
        }
        // Truthy stops the iteration; overlapping circles would both fire.
        return true;
      },
      // Only the marker layer has cluster features.
      { layerFilter: (layer) => layer.get('id') === 'markerLayer' },
    );
  });
};

export const updateSearchMarkers = (
  searchResults: SearchResult[],
  hoveredResult: { lon: number; lat: number } | null,
  selectedResult: SearchResult | null,
  // Optional, so a caller that only places a marker leaves the last handler.
  onResultClick?: (res: SearchResult) => void,
) => {
  const map = getDefaultStore().get(mapAtom);
  const markerLayer = getMarkerLayer();
  const markerSource = getMarkerSource(markerLayer);

  if (onResultClick) {
    onMarkerResultClick = onResultClick;
  }
  registerMarkerClickHandler(map);

  // The style function closes over hoveredResult; a new one forces the redraw.
  markerLayer.setStyle((feature) => clusterStyle(feature, hoveredResult));

  const markers: Feature[] = [];

  if (
    selectedResult &&
    isFinite(selectedResult.lon) &&
    isFinite(selectedResult.lat)
  ) {
    markers.push(createMarker(selectedResult, 'red', map));
  }

  // A selected place/address/property is alone on the map; a selected
  // coordinate still shows the result list alongside it.
  const selectedOnly =
    selectedResult != null && selectedResult.type !== 'Coordinate';

  if (!selectedOnly) {
    searchResults.forEach((res) => {
      if (!isFinite(res.lon) || !isFinite(res.lat)) return;
      if (
        selectedResult &&
        res.lon === selectedResult.lon &&
        res.lat === selectedResult.lat
      ) {
        return;
      }

      const isHovered =
        hoveredResult &&
        hoveredResult.lon === res.lon &&
        hoveredResult.lat === res.lat;

      const iconSrc = isHovered ? 'red' : 'blue';

      const marker = createMarker(res, iconSrc, map);
      marker.setProperties({ isMarker: true });
      markers.push(marker);
    });
  }

  // One addFeatures: Cluster re-clusters on every 'change', one per addFeature.
  markerSource.clear();
  markerSource.addFeatures(markers);
};
