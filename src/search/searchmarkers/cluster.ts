import { Feature } from 'ol';
import { FeatureLike } from 'ol/Feature';
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style';

export const clusterStyle = (
  feature: FeatureLike,
  hoveredResult: { lon: number; lat: number } | null,
): Style | undefined => {
  const clusterFeatures = feature.get('features');

  if (clusterFeatures && clusterFeatures.length > 1) {
    const containsHoveredResult = clusterFeatures.some((f: Feature) => {
      const res = f.get('searchResult');
      return (
        hoveredResult &&
        res &&
        res.lon === hoveredResult.lon &&
        res.lat === hoveredResult.lat
      );
    });

    return new Style({
      image: new CircleStyle({
        radius: 15,
        fill: new Fill({
          color: containsHoveredResult ? '#E54848FF' : '#476ED4B3',
        }),
        stroke: new Stroke({ color: '#fff', width: 2 }),
      }),
      text: new Text({
        text: clusterFeatures.length.toString(),
        fill: new Fill({ color: '#fff' }),
        font: 'bold 14px Arial',
      }),
    });
  }

  // A cluster of one renders as the marker `createMarker` already styled it
  // with. Nothing else can be in this layer, so an empty cluster draws nothing.
  return clusterFeatures?.[0]?.getStyle?.();
};
