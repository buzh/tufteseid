import { useAtomValue } from 'jotai';
import { Feature } from 'ol';
import type { Coordinate } from 'ol/coordinate';
import { boundingExtent } from 'ol/extent';
import { Polygon } from 'ol/geom';
import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import Modify from 'ol/interaction/Modify';
import Translate from 'ol/interaction/Translate';
import VectorLayer from 'ol/layer/Vector';
import { transform, transformExtent } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import CircleStyle from 'ol/style/Circle';
import { useEffect, useRef } from 'react';
import { LocalityBbox } from '../api/localities';
import { mapAtom } from '../map/atoms';
import { addOwnedInteraction, type InteractionOwner } from '../map/interactions';
import { clampBboxSize } from './bboxLimits';

/*
 * A rectangle you can move and resize on the map, and nothing else.
 *
 * Both surfaces that author a bbox run on this: placing a new lokalitet
 * (`useLocalityPlacement`) and reshaping an existing one (`useLocalityAdjust`,
 * "Juster området"). They differ in what they do with the result — one is
 * holding a rectangle that has no record yet, the other is writing into an edit
 * buffer — and in nothing else, which is why the gesture lives here rather than
 * twice.
 *
 * The rectangle sits on a temp layer of its own where it can be dragged whole
 * (`Translate`) or resized by its corners (`Modify`). A corner drag deforms the
 * ring during the gesture and snaps back to a rectangle on release: the dragged
 * corner plus the opposite original corner define the new extent. Then the
 * extent goes through `clampBboxSize`, so the snap to a rectangle and the snap
 * into the size band are one motion.
 *
 * Two callbacks, because the two questions have different answers mid-gesture:
 * `onChange` fires on a finished gesture with the clamped rectangle and is what
 * anything downstream should read, while `onLive` fires on every frame with
 * whatever the ring currently spans, for a readout that has to keep up with the
 * hand.
 */

const CORNER_GRAB_PX = 12;

const handleStyle = new Style({
  stroke: new Stroke({ color: '#FF6A00', width: 3 }),
  fill: new Fill({ color: 'rgba(255, 106, 0, 0.10)' }),
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: '#ffffff' }),
    stroke: new Stroke({ color: '#FF6A00', width: 2 }),
  }),
});

const ring = (polygon: Polygon): Coordinate[] =>
  polygon.getCoordinates()[0].map((c) => [...c] as Coordinate);

export type BboxHandlesOptions = {
  /** Mount the layer and the interactions while this is true. */
  active: boolean;
  /**
   * Where the rectangle starts. Read **once**, when the session begins: the
   * gesture owns the geometry from then on, and re-seeding from a prop would
   * fight the hand that is dragging it.
   */
  seed: LocalityBbox;
  /**
   * Restarts the session when it changes — the open lokalitet's id for adjust,
   * a placement's id for a new one. Keyed rather than deep-compared so that
   * "this is a different rectangle now" is something the caller states.
   */
  sessionKey: string;
  owner: InteractionOwner;
  layerId: string;
  /** A finished gesture, clamped into the band. */
  onChange: (bbox: LocalityBbox) => void;
  /** Every frame of one, unclamped. */
  onLive?: (bbox: LocalityBbox) => void;
  /** Runs on mount and its return value on unmount — see useLocalityAdjust. */
  onMount?: () => () => void;
};

export const useBboxHandles = ({
  active,
  seed,
  sessionKey,
  owner,
  layerId,
  onChange,
  onLive,
  onMount,
}: BboxHandlesOptions) => {
  const map = useAtomValue(mapAtom);

  const seedRef = useRef(seed);
  seedRef.current = seed;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;
  const onMountRef = useRef(onMount);
  onMountRef.current = onMount;

  useEffect(() => {
    if (!active) return;

    const projection = map.getView().getProjection().getCode();
    const toBbox = (extent: number[]) =>
      transformExtent(extent, projection, 'EPSG:4326') as LocalityBbox;

    const extent = transformExtent(seedRef.current, 'EPSG:4326', projection);
    const feature = new Feature({ geometry: polygonFromExtent(extent) });
    const source = new VectorSource({ features: [feature] });
    const layer = new VectorLayer({
      source,
      zIndex: 8,
      style: handleStyle,
      properties: { id: layerId },
    });
    map.addLayer(layer);
    const unmount = onMountRef.current?.();

    feature.on('change', () => {
      const geom = feature.getGeometry();
      if (!(geom instanceof Polygon)) return;
      onLiveRef.current?.(toBbox(geom.getExtent()));
    });

    const persist = () => {
      const geom = feature.getGeometry();
      if (!(geom instanceof Polygon)) return;
      const e = geom.getExtent();
      if (e[2] - e[0] <= 0 || e[3] - e[1] <= 0) return;
      onChangeRef.current(toBbox(e));
    };

    const cornerAtPixel = (pixel: number[]): boolean => {
      const geom = feature.getGeometry();
      if (!(geom instanceof Polygon)) return false;
      return ring(geom).some((c) => {
        const p = map.getPixelFromCoordinate(c);
        return (
          Math.abs(p[0] - pixel[0]) <= CORNER_GRAB_PX &&
          Math.abs(p[1] - pixel[1]) <= CORNER_GRAB_PX
        );
      });
    };

    let ringBefore: Coordinate[] | null = null;

    const modify = new Modify({
      source,
      insertVertexCondition: () => false,
    });
    modify.on('modifystart', () => {
      const geom = feature.getGeometry();
      ringBefore = geom instanceof Polygon ? ring(geom) : null;
    });
    modify.on('modifyend', () => {
      const geom = feature.getGeometry();
      if (!(geom instanceof Polygon) || !ringBefore) return;
      const ringAfter = ring(geom);
      // Which corner moved? (Ring is closed; corners are indexes 0-3.)
      let moved = -1;
      for (let i = 0; i < 4; i++) {
        const [bx, by] = ringBefore[i];
        const [ax, ay] = ringAfter[i];
        if (bx !== ax || by !== ay) {
          moved = i;
          break;
        }
      }
      if (moved >= 0) {
        const anchor = ringBefore[(moved + 2) % 4];
        const dragged = boundingExtent([anchor, ringAfter[moved]]);
        // Clamped about the corner that did not move, with the rectangle as it
        // stood when the drag started as the ceiling — which is what lets a
        // record that is already over the band be shrunk rather than snapped.
        const clamped = clampBboxSize(
          toBbox(dragged),
          transform(anchor, projection, 'EPSG:4326') as [number, number],
          toBbox(boundingExtent(ringBefore)),
        );
        geom.setCoordinates(
          polygonFromExtent(
            transformExtent(clamped, 'EPSG:4326', projection),
          ).getCoordinates(),
        );
      }
      ringBefore = null;
      persist();
    });

    const translate = new Translate({
      layers: [layer],
      // Leave corner grabs to Modify; body drags move the rectangle.
      condition: (e) => !cornerAtPixel(e.pixel as number[]),
    });
    translate.on('translateend', persist);

    addOwnedInteraction(map, owner, translate);
    addOwnedInteraction(map, owner, modify);

    return () => {
      map.removeInteraction(modify);
      map.removeInteraction(translate);
      map.removeLayer(layer);
      unmount?.();
    };
  }, [active, map, sessionKey, owner, layerId]);
};
