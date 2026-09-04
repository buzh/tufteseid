import { getDefaultStore } from 'jotai';
import { Feature } from 'ol';
import { createEmpty, extend } from 'ol/extent';
import { Point } from 'ol/geom';
import VectorLayer from 'ol/layer/Vector';
import Map from 'ol/Map';
import Cluster from 'ol/source/Cluster';
import VectorSource from 'ol/source/Vector';
import { getMarkerLayer } from '../../draw/drawControls/hooks/mapLayers';
import { mapAtom } from '../../map/atoms';
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
      padding: [50, 50, 50, 50],
      maxZoom: minZoom,
    });
  }
};

// The clustered source, built once and reused. updateSearchMarkers runs
// on every hover over a result row, and a fresh VectorSource + Cluster
// each time threw away the computed clusters and made OL re-cluster and
// re-render the whole set — for a change that only recolours one marker.
// Read back off the layer rather than held in a module variable, so it
// heals if the layer is ever re-sourced from elsewhere.
const getMarkerSource = (markerLayer: VectorLayer): VectorSource => {
  const existing = markerLayer.getSource();
  if (existing instanceof Cluster) {
    return existing.getSource() as VectorSource;
  }
  const source = new VectorSource();
  markerLayer.setSource(new Cluster({ distance: 40, source }));
  return source;
};

// What a click on a marker does. The handler below is registered once
// and lives as long as the map, while this callback comes out of a React
// render and changes identity — so the handler reads it at click time
// rather than closing over whichever one was current at registration.
// That capture was a bug: the callback is optional (useMapClickSearch
// drops a coordinate marker without one), so whoever called first owned
// every marker click thereafter.
let onMarkerResultClick: (res: SearchResult) => void = () => {};

const registerMarkerClickHandler = (map: Map) => {
  if (map.get('markerClickHandler')) return;
  map.set('markerClickHandler', true);
  map.on('singleclick', (evt) => {
    map.forEachFeatureAtPixel(
      evt.pixel,
      (feature) => {
        const featuresAtPixel = feature.get('features') as
          | Feature[]
          | undefined;
        if (!featuresAtPixel?.length) {
          return false;
        }

        if (featuresAtPixel.length === 1) {
          handleMarkerClick(featuresAtPixel[0], onMarkerResultClick);
        } else {
          handleClusterClick(featuresAtPixel, map, onMarkerResultClick);
        }
        // Truthy stops the iteration. Overlapping cluster circles put
        // more than one hit under the same pixel, and without this both
        // would fire — two onResultClick calls, or a view.fit racing a
        // popup.
        return true;
      },
      // Only the marker layer has cluster features; hit-testing the draw
      // and lokalitet layers as well was work thrown away every click.
      { layerFilter: (layer) => layer.get('id') === 'markerLayer' },
    );
  });
};

export const updateSearchMarkers = (
  searchResults: SearchResult[],
  hoveredResult: { lon: number; lat: number } | null,
  selectedResult: SearchResult | null,
  // Optional: callers that only place a marker (a map click dropping a
  // coordinate pin) leave whatever the results list last registered in
  // place instead of clobbering it with a no-op.
  onResultClick?: (res: SearchResult) => void,
) => {
  const map = getDefaultStore().get(mapAtom);
  const markerLayer = getMarkerLayer();
  const markerSource = getMarkerSource(markerLayer);

  if (onResultClick) {
    onMarkerResultClick = onResultClick;
  }
  registerMarkerClickHandler(map);

  // Re-set every call: the style function closes over hoveredResult, and
  // handing the layer a new one is what makes it redraw with it.
  markerLayer.setStyle((feature) => clusterStyle(feature, hoveredResult));

  const markers: Feature[] = [];

  if (
    selectedResult &&
    isFinite(selectedResult.lon) &&
    isFinite(selectedResult.lat)
  ) {
    markers.push(createMarker(selectedResult, 'red', map));
  }

  // A selected place/address/property is the only thing on the map; a
  // selected coordinate still shows the result list alongside it.
  const selectedOnly =
    selectedResult != null && selectedResult.type !== 'Coordinate';

  if (!selectedOnly) {
    searchResults.forEach((res) => {
      if (!isFinite(res.lon) || !isFinite(res.lat)) return;
      // Skip if this result is the same as the selected result to avoid duplicate markers
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

  // One clear + one addFeatures rather than a call per marker: Cluster
  // re-clusters on every 'change' its source fires, and addFeature fires
  // one each.
  markerSource.clear();
  markerSource.addFeatures(markers);
};
