import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalityBbox } from '../api/localities';
import { isSignedInAtom } from '../auth/atoms';
import { isAuthDialogOpenAtom } from '../auth/atoms-dialog';
import { mapAtom } from '../map/atoms';
import { mapToolAtom } from '../map/overlay/atoms';
import { toast } from '../ui';
import { activeLocalityAtom } from './atoms';
import { clampBboxSize } from './bboxLimits';
import { viewportBbox } from './createFromBbox';

// The rectangle that exists before the record does. An atom rather than
// component state because two rows read it across the sibling gap: `Ribbon`
// decides whether the placement row exists, and `localityLayer` stops opening
// neighbouring lokaliteter while one is being placed.
export type LocalityPlacement = {
  // One placement session; `useBboxHandles` restarts on it, so a second press
  // re-seeds the rectangle from the screen.
  id: string;
  bbox: LocalityBbox;
  // Armed at the commit, only on success.
  then: 'terrain' | null;
};

export const localityPlacementAtom = atom<LocalityPlacement | null>(null);

let sessionCounter = 0;

/** Both entrances to a new lokalitet. Writes nothing; `Opprett` does. */
export const useStartLocalityPlacement = () => {
  const { t } = useTranslation();
  const map = useAtomValue(mapAtom);
  const isSignedIn = useAtomValue(isSignedInAtom);
  const openAuthDialog = useSetAtom(isAuthDialogOpenAtom);
  const setPlacement = useSetAtom(localityPlacementAtom);
  const setActiveLocality = useSetAtom(activeLocalityAtom);
  const setTool = useSetAtom(mapToolAtom);

  return useCallback(
    (then: 'terrain' | null = null) => {
      if (!isSignedIn) {
        openAuthDialog(true);
        return;
      }
      const seed = viewportBbox(map);
      if (!seed) {
        // The chrome is covering the whole map: nothing to seed from.
        toast.error({ title: t('localities.createFailed') });
        return;
      }
      setActiveLocality(null);
      setTool(null);
      sessionCounter += 1;
      setPlacement({
        id: `place-${sessionCounter}`,
        // Clamped about the centre, so a viewport outside the band yields the
        // nearest allowed rectangle rather than a refusal.
        bbox: clampBboxSize(seed, 'centre'),
        then,
      });
    },
    [
      isSignedIn,
      openAuthDialog,
      map,
      t,
      setActiveLocality,
      setTool,
      setPlacement,
    ],
  );
};
