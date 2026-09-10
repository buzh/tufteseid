// Shows where a LiDAR project actually lies while the ribbon's dataset
// pulldown is open: the footprint of the row the pointer is on, plus the
// dataset currently in use. Picking happens in the list, not here — this
// is the "you are pointing at *that* valley" half of it, which is why it
// lives and dies with the pulldown rather than staying up for the whole
// LiDAR session.
//
// Fetching + relevance classification happens here and is written to
// lidarViewportAtom, which the ribbon pulldown also reads — one WFS call
// and one classification pass serve both the drawn shapes and the list.

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
import { backgroundLayerAtom } from './layers/config/backgroundLayers/atoms';
import {
  AUTO_ENGAGE_M_PER_PX,
  lidarAutoDatasetAtom,
} from './layers/config/backgroundLayers/lidarAuto';
import {
  fetchLidarFootprints,
  touchesExtent,
  viewportCoverage,
} from './layers/config/backgroundLayers/lidarFootprints';
import {
  activeLidarProjectAtom,
  bboxIntersects,
  bboxOverlapRatio,
  fetchLidarProjects,
  sortProjectsByRelevance,
} from './layers/config/backgroundLayers/lidarProjects';
import {
  classifyRelevance,
  emptyLidarViewport,
  hoveredLidarProjectIdAtom,
  lidarCyclingAtom,
  lidarFilterSettingsAtom,
  lidarPickerOpenAtom,
  lidarViewportAtom,
  LidarViewportEntry,
  sortByOnScreenCoverage,
} from './layers/config/backgroundLayers/lidarRelevance';

export const LIDAR_FOOTPRINTS_LAYER_ID = 'lidarFootprintsLayer';

// Furthest out the pulldown will try to answer "what covers this view".
// Expressed as a zoom level rather than a viewport width because that's
// what the cutoff feels like in use, and it doesn't move with the
// browser window.
//
// Not a cost bound any more — FOOTPRINT_FETCH_CAP below bounds the work
// at every zoom. It's that the answer stops being a picker: a
// whole-country view intersects some 450 acquisitions, of which the list
// can show 25, and "these 25 counties have LiDAR" is not a choice anyone
// is trying to make. The honest response out here is "zoom in".
const MIN_FOOTPRINT_ZOOM = 7;

// How many candidates get a real footprint fetched. Candidates are
// ordered by bboxOverlapRatio first — an upper bound on real coverage —
// so the ones this drops are the ones that could not have made the top
// of the list anyway. Sized above RENDER_CAP (25) with room for the
// envelope-vs-polygon slack, and it's also the request budget: 60 name
// queries at 6 concurrent is ~2 s cold and free once cached.
const FOOTPRINT_FETCH_CAP = 60;

// Auto (lidarAuto.ts) keeps this refreshing for a whole LiDAR session
// rather than only while a pulldown is open, so a pan gesture that ends in
// three quick moveends should cost one pass, not three. Short enough not to
// be felt: the fetch behind it takes an order of magnitude longer cold, and
// nothing longer once cached.
const REFRESH_DEBOUNCE_MS = 250;

type Tier = 'hover' | 'active';

// At most two footprints are on screen at a time, so the styles can
// afford to be loud. Both draw a white casing under a saturated core:
// the base underneath is either green topo or grey-brown hillshade, and
// a plain coloured outline disappears into one or the other — an earlier
// green outline over green topo was effectively invisible.
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

// No fill: the active dataset is usually the one being read, and tinting
// the terrain it covers defeats the purpose.
const ACTIVE_STYLE = [
  new Style({ stroke: casing(5), zIndex: 0 }),
  new Style({
    stroke: new Stroke({ color: '#1C6FE0', width: 2, lineDash: [7, 5] }),
    zIndex: 1,
  }),
];

const styleFor = (feature: FeatureLike): Style[] =>
  feature.get('tier') === 'hover' ? HOVER_STYLE : ACTIVE_STYLE;

const getOrCreateLayer = (map: OlMap): VectorLayer => {
  const existing = map
    .getLayers()
    .getArray()
    .find((l) => l.get('id') === LIDAR_FOOTPRINTS_LAYER_ID) as
    | VectorLayer
    | undefined;
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

// Mount once (src/shell/useMapSideEffects.ts) alongside the other
// map-effect hooks.
export const useLidarFootprintsLayer = () => {
  const map = useAtomValue(mapAtom);
  const backgroundLayer = useAtomValue(backgroundLayerAtom);
  const activeLidarProject = useAtomValue(activeLidarProjectAtom);
  const filters = useAtomValue(lidarFilterSettingsAtom);
  const viewport = useAtomValue(lidarViewportAtom);
  const setViewport = useSetAtom(lidarViewportAtom);
  const pickerOpen = useAtomValue(lidarPickerOpenAtom);
  const cycling = useAtomValue(lidarCyclingAtom);
  const autoDataset = useAtomValue(lidarAutoDatasetAtom);
  const hoveredProjectId = useAtomValue(hoveredLidarProjectIdAtom);
  const setHoveredProjectId = useSetAtom(hoveredLidarProjectIdAtom);

  const isLidarBackground =
    backgroundLayer === 'lidarProject' || backgroundLayer === 'lidarHillshade';
  // The pulldown is only on the bar while LiDAR is the ground on screen, but
  // check both — the atom can be left true if the popover unmounts without
  // closing itself (which is why useGroundMode calls standDown).
  const picking = isLidarBackground && pickerOpen;
  // Keyboard cycling walks the same list without opening anything, so it
  // needs the fetch but not the drawing.
  //
  // Auto is the third consumer, and the only one that isn't a transient
  // interaction: while it is on, the list *is* the dataset selection, so it
  // has to stay current for as long as LiDAR mode is. That would be
  // expensive at every zoom, which is why `refresh` below additionally
  // declines to fetch on auto's behalf out where auto already knows the
  // answer without asking.
  const wantsViewport =
    picking || (isLidarBackground && (cycling || autoDataset));

  // Layer lifecycle: created lazily, visibility follows the pulldown.
  // Hover is cleared on the way out so a row the pointer happened to be
  // over when the pulldown closed doesn't flash back on reopen.
  useEffect(() => {
    const layer = getOrCreateLayer(map);
    layer.setVisible(picking);
    if (!picking) setHoveredProjectId(null);
  }, [map, picking, setHoveredProjectId]);

  // Fetch + classify on viewport change, while the pulldown is open, the
  // keyboard is cycling datasets, or auto is resolving them.
  useEffect(() => {
    if (!wantsViewport) {
      setViewport(emptyLidarViewport('idle'));
      return;
    }
    let cancelled = false;
    // Panning fires refreshes faster than the WFS answers them; only the
    // newest one may write to the atom, or a slow early response can
    // overwrite the coverage for where the user actually ended up.
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
        | [number, number, number, number]
        | undefined;
      if (!extentLonLat) return;

      // Claimed before the two scale guards too, so a fetch started while
      // zoomed in can't land afterwards and overwrite the guard state.
      const request = ++latestRequest;
      const isStale = () => cancelled || request !== latestRequest;

      // Auto on its own doesn't need this list out where it would resolve
      // to the national mosaic regardless — and that is most of the zoom
      // range, including every view wide enough for the candidate set to be
      // large. Skipping it there is what keeps always-on auto affordable.
      // An open pulldown or an armed W/S ring still wants an answer at any
      // zoom the WFS will give one, so this only applies when auto is the
      // sole reason we're here.
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

      // getZoom() is a log2 of the resolution, so an integral zoom can
      // come back a hair under itself — don't lock the user out of the
      // threshold level they're standing on.
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
          // The catalogue's GetCapabilities bounding boxes are true
          // envelopes, so this prefilter is *complete* — it can only
          // over-include. That completeness is what lets the footprint
          // fetch be a per-name lookup instead of a spatial query the
          // WFS answers wrong at small extents (see lidarFootprints.ts).
          // What actually qualifies a project for the list is its real
          // polygon touching the viewport, decided below.
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
                // No boundary in the WFS, or one whose only overlap with
                // the viewport was its envelope's: the project has
                // nothing on this screen, so it isn't in this list.
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
        .catch((err) => {
          console.warn('[lidarFootprintsLayer] refresh failed', err);
          if (!isStale()) setViewport(emptyLidarViewport('error'));
        });
    };

    // Immediate on mount — opening the pulldown should not sit on an empty
    // list for a quarter second — and debounced thereafter.
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

  // Render: the hovered row's footprint plus the active dataset's, and
  // nothing else. Both come out of the same viewport lists the pulldown
  // renders, so a row can only light up terrain that's actually been
  // fetched and classified.
  useEffect(() => {
    const layer = getOrCreateLayer(map);
    const source = layer.getSource();
    if (!source) return;
    source.clear();
    // Cycling keeps the viewport list current with the pulldown shut;
    // building features it would never show is pure waste.
    if (!picking) return;

    const entries = [...viewport.primary, ...viewport.secondary];
    const byId = (id: string | null | undefined) =>
      id ? entries.find((e) => e.project.id === id) : undefined;

    const draw = (entry: LidarViewportEntry | undefined, tier: Tier) => {
      if (!entry) return;
      for (const geometry of entry.geometries) {
        const feature = new Feature({ geometry });
        feature.set('tier', tier);
        source.addFeature(feature);
      }
    };

    // Hovering the active dataset's own row should read as hover — it's
    // the row the user is asking about.
    const activeEntry = byId(activeLidarProject?.id);
    if (activeEntry && activeEntry.project.id !== hoveredProjectId) {
      draw(activeEntry, 'active');
    }
    draw(byId(hoveredProjectId), 'hover');
  }, [map, picking, viewport, activeLidarProject, hoveredProjectId]);
};
