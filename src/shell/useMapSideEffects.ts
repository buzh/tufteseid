import { useFunnHighlightLayer } from '../localities/funnHighlightLayer';
import { useFunnLayer, useFunnPointer } from '../localities/funnLayer';
import {
  useLocalitiesLayer,
  useLocalityClick,
} from '../localities/localityLayer';
import { useFunnVisibility } from '../localities/funnVisibility';
import { useLocalityShareLink } from '../localities/shareLink';
import { useFeatureInfoClick } from '../map/featureInfo/useFeatureInfo';
import { useLidarFootprintsLayer } from '../map/lidarFootprintsLayer';
import { useBackgroundCyclingKeys } from '../map/useBackgroundCyclingKeys';
import { useSearchEffects } from '../search/atoms';
import { useMapClickSearch } from '../search/hooks';

/**
 * Everything the shell has to mount for the map to behave. Mount exactly
 * once: `useLocalitiesLayer`, `useFunnLayer` and `useFunnHighlightLayer` each
 * hold a PocketBase realtime subscription whose cleanup calls `source.clear()`,
 * so a second mount means duplicate features and an empty layer when either
 * unmounts.
 *
 * `useLidarFootprintsLayer` is not decoration: it is the only writer of
 * `lidarViewportAtom`, which the dataset pulldown and W/S cycling read. Drop
 * it and cycling silently pins to the national mosaic.
 */
export const useMapSideEffects = () => {
  useFeatureInfoClick();
  useSearchEffects();
  useMapClickSearch();
  // Lokaliteter: rectangle layer, funn layer, halo, pointer link, open.
  useLocalitiesLayer();
  useFunnLayer();
  useFunnHighlightLayer();
  useFunnPointer();
  useLocalityClick();
  // `?lok=CODE`, both directions. Here rather than in the ribbon because it
  // has to run while nothing is open, and mounted exactly once.
  useLocalityShareLink();
  // After the three layers it hides, so the first pass finds them.
  useFunnVisibility();
  useLidarFootprintsLayer();
  // A/D/W/S/E cycling. At the shell root so the document listener's place in
  // the capture chain does not depend on which control is rendered.
  useBackgroundCyclingKeys();
};
