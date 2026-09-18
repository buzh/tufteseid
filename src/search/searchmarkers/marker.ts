import { Feature, Map } from 'ol';
import { Point } from 'ol/geom';
import { transform } from 'ol/proj';
import { Icon, Style } from 'ol/style';
import { getInputCRS } from '../../shared/utils/crsUtils';
import { SearchResult } from '../../types/searchTypes';

// Blue for a result in the list, red for the selected one. Nothing else
// distinguishes a marker.
type MarkerColor = 'red' | 'blue';

export const createMarkerStyle = (iconSrc: string): Style => {
  return new Style({
    image: new Icon({
      src: iconSrc,
      anchor: [0.5, 1],
      scale: 2.0,
    }),
  });
};

export const createMarker = (
  res: SearchResult,
  markerColor: MarkerColor,
  map: Map,
): Feature => {
  const iconSrc = `/location/location_${markerColor}.svg`;
  const marker = new Feature({
    geometry: new Point(
      transform(
        [res.lon, res.lat],
        getInputCRS(res),
        map.getView().getProjection(),
      ),
    ),
  });
  marker.setProperties({ searchResult: res });
  marker.setStyle(createMarkerStyle(iconSrc));
  return marker;
};
