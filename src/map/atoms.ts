import { atom } from 'jotai';
import { View } from 'ol';
import { defaults as defaultControls, ScaleLine } from 'ol/control';
import { defaults as defaultInteractions } from 'ol/interaction';
import Map from 'ol/Map';
import { get as getProjection } from 'ol/proj';
import { v4 as uuidv4 } from 'uuid';
import { validateProjectionIdString } from '../shared/utils/enumUtils';
import { getUrlParameter, setUrlParameter } from '../shared/utils/urlUtils';
import { ProjectionIdentifier } from './projections/types';

export const DEFAULT_PROJECTION: ProjectionIdentifier = 'EPSG:25833';
export const DEFAULT_ZOOM_LEVEL = 3;
export const DEFAULT_CENTER = [396722, 7197860]; // Center in EPSG:25833

const getInitialMapView = () => {
  const projectionIdFromUrl = validateProjectionIdString(
    getUrlParameter('projection'),
  );
  const projectionId = projectionIdFromUrl
    ? projectionIdFromUrl
    : DEFAULT_PROJECTION;

  const initialProjection = getProjection(projectionId)!;

  let initialZoom = DEFAULT_ZOOM_LEVEL;
  let initialCenter = DEFAULT_CENTER;

  const lon = getUrlParameter('lon');
  const lat = getUrlParameter('lat');
  if (lon != null && lat != null) {
    const parsedLon = parseFloat(lon);
    const parsedLat = parseFloat(lat);
    if (!Number.isNaN(parsedLon) && !Number.isNaN(parsedLat)) {
      // `lon`/`lat` are the raw centre in the `projection` parameter's CRS.
      initialCenter = [parsedLon, parsedLat];
    }
  }

  const zoom = getUrlParameter('zoom');
  if (zoom != null) {
    const parsedZoom = parseFloat(zoom);
    if (!Number.isNaN(parsedZoom)) {
      initialZoom = parsedZoom;
    }
  }

  return new View({
    center: initialCenter,
    minZoom: 3,
    maxZoom: 20,
    zoom: initialZoom,
    projection: initialProjection,
    constrainResolution: true,
    smoothResolutionConstraint: false,
  });
};

export const mapAtom = atom<Map>(() => {
  const map = new Map({
    controls: defaultControls({ zoom: false, rotate: false }).extend([
      new ScaleLine({ bar: true, steps: 4, minWidth: 140, maxWidth: 240 }),
    ]),
    interactions: defaultInteractions({
      altShiftDragRotate: false,
      pinchRotate: false,
    }),
    keyboardEventTarget: document,
    // Default 16 starves the ~130 ms topo base: a cold LiDAR tile takes 3-12 s
    // and a screenful of them pins every slot.
    maxTilesLoading: 48,
  });

  const intialView = getInitialMapView();

  map.setView(intialView);
  map.on('moveend', (e) => {
    const view = e.map.getView();
    const center = view.getCenter();
    if (center) {
      setUrlParameter('lon', center[0].toString());
      setUrlParameter('lat', center[1].toString());
    }
    const zoom = view.getZoom();
    if (zoom && !Number.isNaN(zoom)) {
      setUrlParameter('zoom', zoom.toString());
    }
  });
  const mapId = uuidv4();
  map.setProperties({ id: mapId });

  return map;
});
