// Draws where a LiDAR project lies while the dataset pulldown is open. The
// fetch and the relevance classification also happen here, into
// lidarViewportAtom, so one WFS pass serves both the shapes and the list.
//
// Belongs to the map rather than to a half, so it reads the `live…` atoms:
// arrays holding one value per half that is drawing, all indexed the same way
// (`acrossHalves` in `compare/halves.ts`). A two-ground view has two dataset
// pulldowns and two active flights, and one viewport query between them: both
// halves look at the same extent through the same view, so what covers the
// screen is asked once.
//
// Where the outlines go is a different question, and the answer is the pane
// that is showing the flight they describe. The curtain is one viewport, so its
// two halves share one layer on the main map. The split is two, so each pane
// gets its own layer carrying its own half's dataset — drawing B's flight over
// A's ground would point at the wrong picture, and the pulldown that opened is
// itself a half's.

import { useAtomValue, useSetAtom } from 'jotai';
import { Feature } from 'ol';
import type { FeatureLike } from 'ol/Feature';
import VectorLayer from 'ol/layer/Vector';
import type OlMap from 'ol/Map';
import { transformExtent } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import { useEffect } from 'react';
import { mapAtom } from './atoms';
import { type ViewMode, viewModeAtom } from './compare/halves';
import { getSplitMap, peekSplitMap } from './compare/splitMap';
import { liveBackgroundLayersAtom } from './layers/config/backgroundLayers/atoms';
import { fetchCvatAcquisitions } from './layers/config/backgroundLayers/cvatGround';
import {
  AUTO_ENGAGE_M_PER_PX,
  liveLidarAutoAtom,
} from './layers/config/backgroundLayers/lidarAuto';
import {
  fetchLidarFootprints,
  touchesExtent,
  viewportCoverage,
} from './layers/config/backgroundLayers/lidarFootprints';
import {
  bboxIntersects,
  bboxOverlapRatio,
  fetchLidarProjects,
  liveLidarProjectsAtom,
  sortProjectsByRelevance,
} from './layers/config/backgroundLayers/lidarProjects';
import {
  classifyRelevance,
  emptyLidarViewport,
  hoveredLidarProjectIdAtom,
  lidarCyclingAtom,
  lidarFilterSettingsAtom,
  type LidarFilterSettings,
  lidarViewportAtom,
  LidarViewportEntry,
  livePickerOpenAtom,
  sortByOnScreenCoverage,
} from './layers/config/backgroundLayers/lidarRelevance';
import { LIDAR_LAYERS } from './layers/config/backgroundLayers/stack';

export const LIDAR_FOOTPRINTS_LAYER_ID = 'lidarFootprintsLayer';

// Furthest out the pulldown will answer "what covers this view". Not a cost
// bound but a usefulness one: a whole-country view intersects some 450
// acquisitions and the list shows 25.
const MIN_FOOTPRINT_ZOOM = 7;

// How many candidates get a real footprint fetched. Ordered by bboxOverlapRatio
// first, an upper bound on real coverage, so this only drops ones that could
// not have reached the top of a 25-row list.
const FOOTPRINT_FETCH_CAP = 60;

// Auto keeps this refreshing for a whole LiDAR session, so a pan ending in
// three quick moveends should cost one pass rather than three.
const REFRESH_DEBOUNCE_MS = 250;

type Tier = 'hover' | 'active';

/**
 * The cached acquisitions covering a viewport, tiered the same way the WFS list
 * is, for when the WFS list cannot be had.
 *
 * `geometries: []` is the answer and not a gap: the store publishes an envelope
 * per acquisition, so there is no outline to draw and `areaRatio` is an upper
 * bound rather than what the flight paints. The pulldown reads the viewport's
 * status rather than the ratio when this is the list it is showing.
 */
const heldInView = async (
  extentLonLat: [number, number, number, number],
  filters: LidarFilterSettings,
): Promise<{ primary: LidarViewportEntry[]; secondary: LidarViewportEntry[] }> =>
  classifyRelevance(
    (await fetchCvatAcquisitions())
      .map((a) => ({
        project: a.project,
        geometries: [],
        areaRatio: bboxOverlapRatio(a.project.bboxLonLat, extentLonLat),
      }))
      .filter((e) => e.areaRatio > 0)
      .sort(sortByOnScreenCoverage),
    filters,
  );

// A white casing under a saturated core: the base is either green topo or
// grey-brown hillshade, and a plain coloured outline vanishes into one of them.
const casing = (width: number) =>
  new Stroke({ color: 'rgba(255, 255, 255, 0.85)', width });

const HOVER_STYLE = [
  new Style({ stroke: casing(7), zIndex: 2 }),
  new Style({
    stroke: new Stroke({ color: '#D6336C', width: 3 }),
    fill: new Fill({ color: 'rgba(214, 51, 108, 0.12)' }),
    zIndex: 3,
  }),
];

// No fill: the active dataset is the one being read, and tinting the terrain
// it covers defeats the purpose.
const ACTIVE_STYLE = [
  new Style({ stroke: casing(5), zIndex: 0 }),
  new Style({
    stroke: new Stroke({ color: '#1C6FE0', width: 2, lineDash: [7, 5] }),
    zIndex: 1,
  }),
];

const styleFor = (feature: FeatureLike): Style[] =>
  feature.get('tier') === 'hover' ? HOVER_STYLE : ACTIVE_STYLE;

const findLayer = (map: OlMap): VectorLayer | undefined =>
  map
    .getLayers()
    .getArray()
    .find((l) => l.get('id') === LIDAR_FOOTPRINTS_LAYER_ID) as
    | VectorLayer
    | undefined;

const getOrCreateLayer = (map: OlMap): VectorLayer => {
  const existing = findLayer(map);
  if (existing) return existing;
  const layer = new VectorLayer({
    source: new VectorSource(),
    zIndex: 3,
    style: styleFor,
    properties: { id: LIDAR_FOOTPRINTS_LAYER_ID },
  });
  map.addLayer(layer);
  return layer;
};

/**
 * The maps drawing footprints, and which halves' active flights each one is to
 * outline. One entry outside the split, carrying every live half; two in it,
 * one per pane, because each pane draws a ground of its own.
 */
const footprintTargets = (
  main: OlMap,
  mode: ViewMode,
  halfCount: number,
): { host: OlMap; halves: number[] }[] => {
  const all = Array.from({ length: halfCount }, (_, i) => i);
  if (mode !== 'split') return [{ host: main, halves: all }];
  return [
    { host: main, halves: all.slice(0, 1) },
    { host: getSplitMap(), halves: all.slice(1) },
  ];
};

/** The right pane's layer while the right pane is not a target, so what it was
 *  last showing does not come back with it. Never creates one: the pane may
 *  have no map yet, and this must not conjure a second map on an install that
 *  has never opened the split. */
const strandedLayer = (mode: ViewMode): VectorLayer | undefined => {
  if (mode === 'split') return undefined;
  const pane = peekSplitMap();
  return pane ? findLayer(pane) : undefined;
};

/** Mount once, from whatever owns the map's side effects. */
export const useLidarFootprintsLayer = () => {
  const map = useAtomValue(mapAtom);
  const mode = useAtomValue(viewModeAtom);
  const backgroundLayers = useAtomValue(liveBackgroundLayersAtom);
  const liveProjects = useAtomValue(liveLidarProjectsAtom);
  const filters = useAtomValue(lidarFilterSettingsAtom);
  const viewport = useAtomValue(lidarViewportAtom);
  const setViewport = useSetAtom(lidarViewportAtom);
  const pickersOpen = useAtomValue(livePickerOpenAtom);
  const cycling = useAtomValue(lidarCyclingAtom);
  const autoDatasets = useAtomValue(liveLidarAutoAtom);
  const hoveredProjectId = useAtomValue(hoveredLidarProjectIdAtom);
  const setHoveredProjectId = useSetAtom(hoveredLidarProjectIdAtom);

  // Which halves are on LiDAR at all. Every other array here is indexed the
  // same way, so the conditions below can be read off pairwise.
  const onLidar = backgroundLayers.map((name) => LIDAR_LAYERS.has(name));
  const anyLidar = onLidar.some(Boolean);
  // A half's own ground and its own pulldown, because the picker atom can be
  // left true if the popover unmounts without closing itself (which is why
  // `LidarControlGroup` stands it down).
  const picking = onLidar.some((lidar, i) => lidar && pickersOpen[i]);
  // Cycling and auto both want the fetch and neither wants the drawing.
  const wantsViewport =
    picking ||
    (anyLidar && cycling) ||
    onLidar.some((lidar, i) => lidar && autoDatasets[i]);

  const halfCount = backgroundLayers.length;

  // Hover is cleared on the way out, so it does not flash back on reopen.
  useEffect(() => {
    for (const { host } of footprintTargets(map, mode, halfCount)) {
      getOrCreateLayer(host).setVisible(picking);
    }
    strandedLayer(mode)?.setVisible(false);
    if (!picking) setHoveredProjectId(null);
  }, [map, mode, halfCount, picking, setHoveredProjectId]);

  useEffect(() => {
    if (!wantsViewport) {
      setViewport(emptyLidarViewport('idle'));
      return;
    }
    let cancelled = false;
    // Panning outruns the WFS; only the newest request may write to the atom.
    let latestRequest = 0;

    const refresh = () => {
      const size = map.getSize();
      const center = map.getView().getCenter();
      if (!size || !center) return;
      const extent = map.getView().calculateExtent(size) as [
        number,
        number,
        number,
        number,
      ];
      const projection = map.getView().getProjection().getCode();
      const extentLonLat = transformExtent(extent, projection, 'EPSG:4326') as
        [number, number, number, number] | undefined;
      if (!extentLonLat) return;

      // Claimed before the two scale guards, so a fetch started while zoomed
      // in cannot land afterwards and overwrite the guard state.
      const request = ++latestRequest;
      const isStale = () => cancelled || request !== latestRequest;

      // Out where auto would resolve to the national mosaic regardless it does
      // not need the list, which is what keeps always-on auto affordable.
      const resolution = map.getView().getResolution();
      if (
        !picking &&
        !cycling &&
        (resolution == null || resolution > AUTO_ENGAGE_M_PER_PX)
      ) {
        setViewport((prev) =>
          prev.status === 'idle' ? prev : emptyLidarViewport('idle'),
        );
        return;
      }

      // getZoom() is a log2 of the resolution, so an integral zoom can come
      // back a hair under itself — hence the epsilon.
      const zoom = map.getView().getZoom();
      if (zoom == null || zoom < MIN_FOOTPRINT_ZOOM - 0.001) {
        setViewport((prev) =>
          prev.status === 'zoomedOut' ? prev : emptyLidarViewport('zoomedOut'),
        );
        return;
      }

      setViewport((prev) => ({ ...prev, status: 'loading' }));

      fetchLidarProjects()
        .then((allProjects) => {
          // The catalogue's bounding boxes are true envelopes, so this can only
          // over-include — which is what lets the footprint fetch be a per-name
          // lookup rather than a spatial query (see lidarFootprints.ts).
          const candidates = allProjects
            .filter((p) => bboxIntersects(p.bboxLonLat, extentLonLat))
            .map((project) => ({
              project,
              maxRatio: bboxOverlapRatio(project.bboxLonLat, extentLonLat),
            }))
            .sort(
              (a, b) =>
                b.maxRatio - a.maxRatio ||
                sortProjectsByRelevance(a.project, b.project),
            )
            .slice(0, FOOTPRINT_FETCH_CAP)
            .map(({ project }) => project);

          return fetchLidarFootprints(candidates, projection).then(
            (matches) => {
              if (isStale()) return;
              const entries: LidarViewportEntry[] = [];
              for (const project of candidates) {
                const geometries = matches.get(project.id)?.geometries;
                // No boundary in the WFS, or one whose only overlap with the
                // viewport was its envelope's: nothing on this screen.
                if (!geometries || !touchesExtent(geometries, extent)) continue;
                entries.push({
                  project,
                  geometries,
                  areaRatio: viewportCoverage(geometries, extent),
                });
              }
              entries.sort(sortByOnScreenCoverage);
              const classified = classifyRelevance(entries, filters);
              setViewport({ status: 'ready', ...classified });
            },
          );
        })
        .catch(async (err) => {
          console.warn('[lidarFootprintsLayer] refresh failed', err);
          // Kartverket is not answering — the catalogue, the footprint WFS or
          // both, since one backend renders the lot. The cVAT store needs
          // neither, so what it holds over this viewport is offered in place of
          // an empty list. Only then `error`, which now means what it says:
          // nothing upstream and nothing of our own.
          const held = await heldInView(extentLonLat, filters);
          if (isStale()) return;
          setViewport(
            held.primary.length + held.secondary.length > 0
              ? { status: 'held', ...held }
              : emptyLidarViewport('error'),
          );
        });
    };

    refresh();
    let debounce: number | undefined;
    const onMoveEnd = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(refresh, REFRESH_DEBOUNCE_MS);
    };
    map.on('moveend', onMoveEnd);
    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
      map.un('moveend', onMoveEnd);
    };
  }, [map, wantsViewport, picking, cycling, filters, setViewport]);

  // The hovered row's footprint and the active dataset of whichever halves the
  // host is showing, off the same lists.
  useEffect(() => {
    strandedLayer(mode)?.getSource()?.clear();

    const entries = [...viewport.primary, ...viewport.secondary];
    const byId = (id: string | null | undefined) =>
      id ? entries.find((e) => e.project.id === id) : undefined;

    // A feature per source rather than one shared between them: an OL feature
    // in two sources is one object two renderers hold listeners on.
    const draw = (
      source: VectorSource,
      entry: LidarViewportEntry | undefined,
      tier: Tier,
    ) => {
      if (!entry) return;
      for (const geometry of entry.geometries) {
        const feature = new Feature({ geometry });
        feature.set('tier', tier);
        source.addFeature(feature);
      }
    };

    for (const { host, halves } of footprintTargets(map, mode, halfCount)) {
      const source = getOrCreateLayer(host).getSource();
      if (!source) continue;
      source.clear();
      if (!picking) continue;

      // A set, not one per half: in the curtain two halves reading the same
      // acquisition would otherwise stack two identical outlines and thicken it.
      const activeIds = new Set(
        halves.flatMap((i) => {
          const project = liveProjects[i];
          return project && LIDAR_LAYERS.has(backgroundLayers[i])
            ? [project.id]
            : [];
        }),
      );
      // Hovering an active dataset's own row reads as hover, not active.
      if (hoveredProjectId) activeIds.delete(hoveredProjectId);
      for (const id of activeIds) draw(source, byId(id), 'active');
      draw(source, byId(hoveredProjectId), 'hover');
    }
  }, [
    map,
    mode,
    halfCount,
    picking,
    viewport,
    liveProjects,
    backgroundLayers,
    hoveredProjectId,
  ]);
};
