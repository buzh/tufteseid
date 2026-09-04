import { atom } from 'jotai';
import { View } from 'ol';
import { defaults as defaultControls, ScaleLine } from 'ol/control';
import { defaults as defaultInteractions } from 'ol/interaction';
import Map from 'ol/Map';
import { get as getProjection, transform } from 'ol/proj';
import { v4 as uuidv4 } from 'uuid';
import { parseCoordinateInput } from '../shared/utils/coordinateParser';
import { validateProjectionIdString } from '../shared/utils/enumUtils';
import { getUrlParameter, setUrlParameter } from '../shared/utils/urlUtils';
import { mapLayers } from './layers';
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
      // If the values are in the WGS84 degree range they are geographic
      // coordinates and must be transformed to the current projection.
      // Current URLs always store the raw projected center (large UTM-range numbers),
      // so this branch only fires for legacy / externally-generated links.
      if (Math.abs(parsedLat) <= 90 && Math.abs(parsedLon) <= 180) {
        let centerResolved = false;
        // Prefer the 'sok' parameter when it encodes a valid coordinate
        const sokParam = getUrlParameter('sok');
        if (sokParam) {
          const parsedCoord = parseCoordinateInput(sokParam, projectionId);
          if (parsedCoord) {
            initialCenter = transform(
              [parsedCoord.lon, parsedCoord.lat],
              parsedCoord.projection,
              projectionId,
            );
            centerResolved = true;
          }
        }

        if (!centerResolved) {
          initialCenter = transform(
            [parsedLon, parsedLat],
            'EPSG:4326',
            projectionId,
          );
        }
      } else {
        initialCenter = [parsedLon, parsedLat];
      }
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
      new ScaleLine({ minWidth: 100 }),
    ]),
    // There is no rotation UI (compass rose / reset button), so lock the
    // map north-up — otherwise a stray gesture leaves the user with a
    // rotation they have no way to clear.
    interactions: defaultInteractions({
      altShiftDragRotate: false,
      pinchRotate: false,
    }),
    keyboardEventTarget: document,
    // OpenLayers runs ONE tile queue for the whole map and will not
    // start a new tile while `maxTilesLoading` are already in flight —
    // the default 16 assumes tile servers answer in milliseconds. Ours
    // do not: a cold LiDAR WMS tile is 3-12 s at Kartverket's origin, so
    // a screenful of them pins every slot and the topo base — which
    // answers in ~130 ms and is the whole reason there is always
    // supposed to be *something* on screen — never gets scheduled at
    // all. A wider window lets the fast base layer slip past the slow
    // hillshade instead of queueing behind it.
    maxTilesLoading: 48,
  });

  map.addLayer(mapLayers.markerLayer.getLayer());
  map.addLayer(mapLayers.drawLayer.getLayer());
  map.addLayer(mapLayers.drawOverlayLayer.getLayer());
  map.addLayer(mapLayers.posterMarkerLayer.getLayer());
  map.addLayer(mapLayers.measureLayer.getLayer());

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
