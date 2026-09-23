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
      // `lat`/`lon` are the raw centre in whatever `projection` says, which is
      // what the app writes back.
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
      // A stepped bar rather than a bare line: alternating segments are what
      // let you carry a distance across the screen by eye, which is the whole
      // use of a scale on relief. Coloured off black and white in `map.css`.
      new ScaleLine({ bar: true, steps: 4, minWidth: 140, maxWidth: 240 }),
    ]),
    // No rotation UI, so a stray gesture would leave a rotation nothing clears.
    interactions: defaultInteractions({
      altShiftDragRotate: false,
      pinchRotate: false,
    }),
    keyboardEventTarget: document,
    // One queue for the whole map. The default 16 assumes millisecond
    // responses; a cold LiDAR tile is 3-12 s, so a screenful of them pins every
    // slot and the ~130 ms topo base never gets scheduled.
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
