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

/*
 * A lokalitet being placed — the rectangle that exists before the record does
 * (docs/ui-architecture.md §5.6).
 *
 * "Ny lokalitet" used to write on the press, framing whatever the screen
 * happened to show. The rectangle it produced was always a little wrong, and by
 * the time you could see that it had already cost a stedsnavn lookup, a WFS
 * query and a three-image starter set over the wrong ground. So the press now
 * *proposes*: a rectangle appears, seeded from the visible map, and the author
 * moves and sizes it against the terrain they are framing. `Opprett` is the
 * only thing here that writes.
 *
 * The state is an atom rather than component state because two rows read it
 * across the sibling gap — `Ribbon` decides whether the placement row exists at
 * all, and `localityLayer` stops opening neighbouring lokaliteter while it does
 * — and because "who is holding the pending rectangle" should have one answer.
 *
 * `then` is what survives from the old "await the record, then arm the tool":
 * pressing Terreng (or `5`) with nothing open places a rectangle first, and the
 * tool is armed at the commit, still only on success.
 */
export type LocalityPlacement = {
  /**
   * One placement session. `useBboxHandles` restarts on it, so a second press
   * of `Ny lokalitet` re-seeds the rectangle from the screen rather than
   * leaving the old one where it was.
   */
  id: string;
  bbox: LocalityBbox;
  then: 'terrain' | null;
};

export const localityPlacementAtom = atom<LocalityPlacement | null>(null);

let sessionCounter = 0;

/**
 * Both entrances to a new lokalitet. Raises the sign-in dialog for a guest,
 * and otherwise writes nothing at all — it puts a rectangle on the map and
 * gets out of the way.
 */
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
        // The chrome is covering the whole map — a short window with the
        // filmstrip up. Nothing to seed from, and a sliver is not worth
        // offering to place.
        toast.error({ title: t('localities.createFailed') });
        return;
      }
      // Closing whatever was open first. Placing a new rectangle already
      // replaced the active lokalitet when the press created one, so this is
      // the same move a beat earlier — and it is free: an edit buffer lives in
      // localStorage and is still there when that record is reopened.
      setActiveLocality(null);
      setTool(null);
      sessionCounter += 1;
      setPlacement({
        id: `place-${sessionCounter}`,
        // Clamped about the centre, which is what retires the old "your
        // viewport is too big to be a lokalitet" refusal: zoomed out you get
        // the largest allowed rectangle on the middle of the screen, zoomed
        // right in the smallest.
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
