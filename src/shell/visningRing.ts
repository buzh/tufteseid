import { atom, useAtomValue } from 'jotai';
import type { ViewSpec } from '../localities/viewSpec';
import { focusedHalfAtom } from '../map/compare/halves';
import {
  provisionalViewAtom,
  visningGroupShownAtom,
  visningShownAtom,
} from '../map/groundOverlay';
import { recreateViewAtom } from './useRecreateView';

// Choosing a View, for the pulldown and for W/S. Published from
// `VisningControl` because the keyboard is registered once, in row 1.

export type VisningStop = {
  id: string;
  /** Carried rather than looked up: the ring is walked from row 1, where the
   * attachments are not. Null when `meta` no longer parses. */
  spec: ViewSpec | null;
};

/** The Views `[Visning ▾]` lists, bottom to top. Empty when it is off. */
export const visningRingAtom = atom<readonly VisningStop[]>([]);

/** Whether W/S is this ring's; one predicate so labels and keys agree. */
export const visningRingHasKeysAtom = atom(
  (get) => get(visningRingAtom).length > 0 && get(focusedHalfAtom) === 'a',
);

// Composed onto a heading rather than translated into it, so the hint moves
// with the keys.
const RING_HINT = ' · W/S';

export const useGroundRingHint = () =>
  useAtomValue(visningRingHasKeysAtom) ? '' : RING_HINT;

export const useVisningRingHint = () =>
  useAtomValue(visningRingHasKeysAtom) ? RING_HINT : '';

/**
 * Show one View, or none, and put the ribbon back on the ground it was made
 * on. `null` is the group's other stop, the bare ground. Two callers in
 * `useLocalityWorkspace` write `visningShownAtom` directly instead, because
 * they must not move the ribbon: the arrival cover, and a scene's own ground.
 */
export const selectVisningAtom = atom(null, (get, set, id: string | null) => {
  set(visningShownAtom, id == null ? new Set<string>() : new Set([id]));
  set(visningGroupShownAtom, true);
  // Spends the arrival cover: the shown set was replaced wholesale.
  set(provisionalViewAtom, null);
  if (id == null) return;
  // No readable spec still selects: the figure goes up, the ground stays.
  const spec = get(visningRingAtom).find((stop) => stop.id === id)?.spec;
  if (spec) set(recreateViewAtom, spec);
});

/**
 * Step the ring over `ring.length + 1` stops, `null` first. Returns whether it
 * was walked, so the caller can fall through to the ground's dataset ring.
 * Position is read off the shown set; with several shown, the topmost.
 */
export const cycleVisningAtom = atom(
  null,
  (get, set, step: 1 | -1): boolean => {
    if (!get(visningRingHasKeysAtom)) return false;
    const ring = get(visningRingAtom);

    const shown = get(visningShownAtom);
    let at = 0;
    ring.forEach((stop, i) => {
      if (shown.has(stop.id)) at = i + 1;
    });

    const stops = ring.length + 1;
    const next = (at + step + stops) % stops;
    set(selectVisningAtom, next === 0 ? null : ring[next - 1].id);
    return true;
  },
);
