import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalityBbox } from '../api/localities';
import { currentUserAtom } from '../auth/atoms';
import { toast } from '../ui';
import { anyOverlayOpenAtom } from '../ui/overlayAtoms';
import {
  activeLocalityAtom,
  editingLocalityIdAtom,
  pendingStarterLocalityIdAtom,
} from './atoms';
import { bboxSpanMetres, MAX_SIDE_M, MIN_SIDE_M } from './bboxLimits';
import { createLocalityFromBbox } from './createFromBbox';
import { type LocalityPlacement, localityPlacementAtom } from './placement';
import { useBboxHandles } from './useBboxHandles';

const PLACE_LAYER_ID = 'localityPlaceLayer';

export type LocalityPlacementApi = {
  /** What the rectangle spans right now, following the hand. */
  bbox: LocalityBbox;
  /** Sitting on a limit, so the readout can say which and why. */
  atLimit: 'min' | 'max' | null;
  creating: boolean;
  commit: () => void;
  cancel: () => void;
};

/**
 * The rectangle before there is a record under it. Mounted once, by
 * `RibbonPlaceLocalityRow`. `localityPlacementAtom` holds the authoritative
 * rectangle, written per finished gesture; what is published here is the live
 * one, because writing the atom at pointer rate re-renders the ribbon.
 */
export const useLocalityPlacement = (
  placement: LocalityPlacement,
): LocalityPlacementApi => {
  const { t } = useTranslation();
  const store = useStore();
  const user = useAtomValue(currentUserAtom);
  const setPlacement = useSetAtom(localityPlacementAtom);
  const setActiveLocality = useSetAtom(activeLocalityAtom);
  const setEditingLocalityId = useSetAtom(editingLocalityIdAtom);
  const setPendingStarter = useSetAtom(pendingStarterLocalityIdAtom);

  const [bbox, setBbox] = useState<LocalityBbox>(placement.bbox);
  const [creating, setCreating] = useState(false);

  const onChange = useCallback(
    (next: LocalityBbox) => {
      setBbox(next);
      setPlacement((cur) => (cur ? { ...cur, bbox: next } : cur));
    },
    [setPlacement],
  );

  useBboxHandles({
    active: true,
    seed: placement.bbox,
    sessionKey: placement.id,
    owner: 'localityPlace',
    layerId: PLACE_LAYER_ID,
    onChange,
    onLive: setBbox,
  });

  const cancel = useCallback(() => setPlacement(null), [setPlacement]);

  // Commits the atom's rectangle, not the live one, so `Enter` mid-drag takes
  // the last finished gesture. Failure leaves the session up.
  const commit = useCallback(async () => {
    if (!user || creating) return;
    setCreating(true);
    try {
      const rec = await createLocalityFromBbox(
        placement.bbox,
        user.id,
        t('localities.defaultName'),
      );
      if (!rec) {
        toast.error({ title: t('localities.createFailed') });
        return;
      }
      // The one exception to "every lokalitet opens in show", batched with the
      // active record so the row never renders it in show first.
      setActiveLocality(rec);
      setEditingLocalityId(rec.id);
      setPendingStarter(rec.id);
      setPlacement(null);
    } finally {
      setCreating(false);
    }
  }, [
    user,
    creating,
    placement.bbox,
    t,
    setActiveLocality,
    setEditingLocalityId,
    setPendingStarter,
    setPlacement,
  ]);

  // Capture phase so OpenLayers' KeyboardPan does not also act on them, and
  // inert while something is being typed into or an overlay is up.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey)
        return;
      if (event.key !== 'Escape' && event.key !== 'Enter') return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
          target.closest(
            '[data-scope="popover"], [data-scope="dialog"], [data-scope="select"]',
          ))
      ) {
        return;
      }
      if (store.get(anyOverlayOpenAtom)) return;
      if (event.key === 'Escape') cancel();
      else void commit();
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [store, cancel, commit]);

  const [width, height] = bboxSpanMetres(bbox);
  // The clamp lands on the limit through two reprojections, so an exact
  // comparison lights up on some rectangles and not on identical ones.
  const near = (value: number, limit: number) => Math.abs(value - limit) < 1;
  const atLimit =
    near(width, MAX_SIDE_M) || near(height, MAX_SIDE_M)
      ? 'max'
      : near(width, MIN_SIDE_M) || near(height, MIN_SIDE_M)
        ? 'min'
        : null;

  return {
    bbox,
    atLimit,
    creating,
    commit: () => void commit(),
    cancel,
  };
};
