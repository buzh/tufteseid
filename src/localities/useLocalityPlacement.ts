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
import { ribbonToolAtom } from './toolAtoms';
import { useBboxHandles } from './useBboxHandles';

const PLACE_LAYER_ID = 'localityPlaceLayer';

export type LocalityPlacementApi = {
  /** What the rectangle spans right now, following the hand mid-drag. */
  bbox: LocalityBbox;
  /** Sitting on a limit, so the readout can say which and why. */
  atLimit: 'min' | 'max' | null;
  creating: boolean;
  commit: () => void;
  cancel: () => void;
};

/**
 * One placement session: the rectangle before there is a record under it.
 *
 * Mounted once, by `RibbonPlaceLocalityRow`, which is the only thing on screen
 * while it lasts — the same arrangement `LocalityRibbon` has with
 * `useLocalityWorkspace`, and for the same reason: a second mount would be a
 * second set of map interactions over the same rectangle.
 *
 * The authoritative rectangle is the one in `localityPlacementAtom`, written on
 * every finished gesture. The one this hook publishes is the *live* one, a
 * frame at a time, so the readout keeps up with the hand — both are clamped
 * (`useBboxHandles` clamps per frame), and the split is only about how often
 * the atom is written: at pointer rate it would re-render the ribbon on every
 * move.
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
  const setRibbonTool = useSetAtom(ribbonToolAtom);

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

  /*
   * `Opprett` — the one write in the whole session.
   *
   * The rectangle it writes is the atom's, not the live one: `Enter` pressed
   * mid-drag commits the last finished gesture rather than the frame the hand
   * happens to be on.
   *
   * The stedsnavn lookup still runs *before* the record is written (§8.3) — it
   * just runs on a rectangle somebody chose. On failure the session stays up,
   * because the alternative is throwing away the placing that was just done.
   */
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
      // The one exception to "every lokalitet opens in show"
      // (docs/lokalitet-view.md §3): a rectangle placed thirty seconds ago has
      // nothing to show. Set in the same batch as the active record, so the row
      // never renders it in show first. The starter set follows it in, unasked
      // (§4.3) — and now over ground the author framed deliberately.
      setActiveLocality(rec);
      setEditingLocalityId(rec.id);
      setPendingStarter(rec.id);
      // What "press Terreng with nothing open" turns into: the rectangle first,
      // the tool after it, and still only on a create that worked — a failed
      // one must not leave 'terrain' armed for whichever lokalitet is opened
      // next.
      if (placement.then === 'terrain') setRibbonTool('terrain');
      setPlacement(null);
    } finally {
      setCreating(false);
    }
  }, [
    user,
    creating,
    placement.bbox,
    placement.then,
    t,
    setActiveLocality,
    setEditingLocalityId,
    setPendingStarter,
    setRibbonTool,
    setPlacement,
  ]);

  /*
   * Escape and Enter, on the same terms as every other keyboard layer in the
   * app (src/localities/useWorkspaceKeys.ts): capture phase so OpenLayers'
   * KeyboardPan does not also act on them, and inert while something is being
   * typed into or an overlay is up.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
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
  // A tolerance, because the clamp lands on the limit through two
  // reprojections: an exact comparison would light up on some rectangles and
  // not on others that look identical.
  const near = (value: number, limit: number) => Math.abs(value - limit) < 1;
  const atLimit = near(width, MAX_SIDE_M) || near(height, MAX_SIDE_M)
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
