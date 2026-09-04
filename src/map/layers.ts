import BaseLayer from 'ol/layer/Base';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';

type LayerFunction = () => BaseLayer;

export type MapLayer = {
  getLayer: LayerFunction;
  maxZoom?: number;
};

export type MapLayers = {
  drawLayer: MapLayer;
  drawOverlayLayer: MapLayer;
  markerLayer: MapLayer;
  posterMarkerLayer: MapLayer;
  propertyGeometryLayer: MapLayer;
  measureLayer: MapLayer;
};

const mapLayers: MapLayers = {
  drawLayer: {
    getLayer: () => {
      return new VectorLayer({
        zIndex: 2,
        source: new VectorSource({ wrapX: false }),
        properties: { id: 'drawLayer' },
      });
    },
  },
  drawOverlayLayer: {
    getLayer: () => {
      return new VectorLayer({
        zIndex: 3,
        source: new VectorSource({ wrapX: false }),
        properties: { id: 'drawOverlayLayer' },
      });
    },
  },
  markerLayer: {
    getLayer: () => {
      return new VectorLayer({
        zIndex: 6,
        source: new VectorSource({ wrapX: false }),
        properties: { id: 'markerLayer' },
      });
    },
  },
  posterMarkerLayer: {
    getLayer: () => {
      return new VectorLayer({
        zIndex: 6,
        source: new VectorSource({ wrapX: false }),
        properties: { id: 'posterMarkerLayer' },
      });
    },
  },

  propertyGeometryLayer: {
    getLayer: () => {
      return new VectorLayer({
        zIndex: 5,
        source: new VectorSource({ wrapX: false }),
        properties: { id: 'propertyGeometryLayer' },
      });
    },
  },
  measureLayer: {
    getLayer: () => {
      return new VectorLayer({
        zIndex: 3,
        source: new VectorSource({ wrapX: false }),
        properties: { id: 'measureLayer' },
      });
    },
  },
};

export { mapLayers };
