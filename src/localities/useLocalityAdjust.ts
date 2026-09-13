import { useAtomValue } from 'jotai';
import { useCallback, useRef } from 'react';
import { LocalityBbox, LocalityRecord } from '../api/localities';
import { adjustingLocalityAtom } from './atoms';
import { hideLocalityOnLayer, upsertLocalityOnLayer } from './localityLayer';
import { useBboxHandles } from './useBboxHandles';

// "Juster området": while adjustingLocalityAtom is set, the open lokalitet's
// rectangle is move/resizable. The gesture itself is `useBboxHandles`, shared
// with placing a new lokalitet; what is left here is the half that is about
// *this record* — taking its rectangle off the shared layer for the duration so
// there are not two of it, and putting the moved one back on the way out.
//
// The hook *reports*, it does not save: the gesture used to PATCH the record on
// every release, and since step 13 the whole of edit is a transaction (§5.6),
// so the new rectangle goes into the caller's draft buffer instead and reaches
// PocketBase on `Lagre` with everything else. The hook still knows nothing
// about where it goes — which is why `[Angre]` can put the old one back without
// this file having an opinion about it.

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
