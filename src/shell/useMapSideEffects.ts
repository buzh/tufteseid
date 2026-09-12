import { useFunnHighlightLayer } from '../localities/funnHighlightLayer';
import { useFunnLayer, useFunnPointer } from '../localities/funnLayer';
import {
  useLocalitiesLayer,
  useLocalityClick,
} from '../localities/localityLayer';
import { useFunnVisibility } from '../localities/funnVisibility';
import { useFeatureInfoClick } from '../map/featureInfo/useFeatureInfo';
import { useLidarFootprintsLayer } from '../map/lidarFootprintsLayer';
import { useBackgroundCyclingKeys } from '../map/useBackgroundCyclingKeys';
import { useSearchEffects } from '../search/atoms';
import { useMapClickSearch } from '../search/hooks';

/**
 * Everything the shell has to mount for the map to behave, in the order it
 * has always been mounted in.
 *
 * Order is not incidental. Three of these register a `singleclick` handler
 * on the same OL map — feature-info, map-click search and click-to-open —
 * and although the coupling between them is state-based rather than
 * order-based, there is no reason to disturb the sequence while replacing
 * the shell around it.
 *
 * `useLidarFootprintsLayer` looks like a pure map decoration and is not:
 * it is the only writer of `lidarViewportAtom`, which both the dataset
 * pulldown and W/S cycling read. Drop it and cycling silently pins to the
 * national mosaic with nothing in the console.
 *
 * Mount this exactly once. `useLocalitiesLayer`, `useFunnLayer` and
 * `useFunnHighlightLayer` each hold a PocketBase realtime subscription
 * whose cleanup calls `source.clear()`, so a second mount gives duplicate
 * features and double reloads — and, on unmount of either, an empty layer.
 */
export const useMapSideEffects = () => {
  useFeatureInfoClick();
  useSearchEffects();
  useMapClickSearch();
  // Lokaliteter: rectangle layer (all visible records), funn layer (open
  // lokalitet only), the selection halo, the map→dock pointer link and
  // click-to-open.
  useLocalitiesLayer();
  useFunnLayer();
  useFunnHighlightLayer();
  useFunnPointer();
  useLocalityClick();
  // After the three layers it hides, so the first pass finds them.
  useFunnVisibility();
  useLidarFootprintsLayer();
  // A/D/W/S/E background cycling. Mounted at the shell root rather than in
  // the ribbon so the document listener's position in the capture chain
  // does not depend on whether the control that drives it is rendered.
  useBackgroundCyclingKeys();
};
