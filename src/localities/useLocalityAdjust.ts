import { useAtomValue } from 'jotai';
import { useCallback, useRef } from 'react';
import { LocalityBbox, LocalityRecord } from '../api/localities';
import { adjustingLocalityAtom } from './atoms';
import { hideLocalityOnLayer, upsertLocalityOnLayer } from './localityLayer';
import { useBboxHandles } from './useBboxHandles';

// "Juster området". The gesture is `useBboxHandles`, shared with placing a new
// lokalitet; what is here is the part about this record — hiding its rectangle
// on the shared layer for the duration, and putting the moved one back after.
// The hook reports and does not save: the new bbox goes to the caller's draft
// buffer and reaches PocketBase on `Lagre`.

const ADJUST_LAYER_ID = 'localityAdjustLayer';

export const useLocalityAdjust = (
  locality: LocalityRecord,
  onBbox: (bbox: LocalityBbox) => void,
) => {
  const adjusting = useAtomValue(adjustingLocalityAtom);

  // Latest record, for the exit-cleanup upsert (the effect closure would
  // otherwise re-render the pre-adjust rectangle).
  const latestRef = useRef<LocalityRecord>(locality);
  latestRef.current = locality;

  const onMount = useCallback(() => {
    hideLocalityOnLayer(latestRef.current.id);
    return () => upsertLocalityOnLayer(latestRef.current);
  }, []);

  useBboxHandles({
    active: adjusting,
    seed: locality.bbox,
    sessionKey: locality.id,
    owner: 'localityAdjust',
    layerId: ADJUST_LAYER_ID,
    onChange: onBbox,
    onMount,
  });
};
