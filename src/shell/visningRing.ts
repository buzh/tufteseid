import { atom, useAtomValue } from 'jotai';
import { focusedHalfAtom } from '../map/compare/halves';
import {
  provisionalViewAtom,
  visningGroupShownAtom,
  visningShownAtom,
} from '../map/groundOverlay';

/*
 * W/S over `[Visning ▾]` — the lokalitet's own kept renders as a ring.
 *
 * Every pulldown in this app comes with W/S (docs/ui-architecture.md §5.3),
 * and since the layer row landed there has been one that did not: the group
 * holding the extracts, terrain renders and ortofoto grabs the lokalitet was
 * made to compare. Flipping between them with one key is the same gesture the
 * flyfoto ring exists for — 2024 → 1963 → 1937 over the same ground — except
 * that here the stack is the user's own readings of it.
 *
 * So inside a lokalitet that has Views, W/S is theirs and the ground's dataset
 * ring is left to the pulldown and the settings strip. Two conditions on that,
 * both in `useGroundMode`: the ring has to have something in it (a lokalitet
 * with no kept renders keeps W/S walking LiDAR projects, which is the only
 * honest thing an empty ring can do), and the compare curtain's B half keeps
 * its own ground ring, since the whole point of `C W W C` is walking the
 * *focused* half's datasets.
 *
 * The ring is published from `VisningControl` rather than read off the
 * workspace here, for the reason `groundHandleAtom` exists: the keyboard is
 * registered once, in row 1, and the group lives on the lokalitet row.
 */

/**
 * The Views `[Visning ▾]` lists, by attachment id, in the order the pulldown
 * lists them — which is the order they paint in, bottom to top. Empty
 * whenever the group is not on screen.
 */
export const visningRingAtom = atom<readonly string[]>([]);

/**
 * Who has W/S at this moment — the two conditions `useGroundMode` applies,
 * stated once so the labels and the keys cannot disagree.
 */
export const visningRingHasKeysAtom = atom(
  (get) => get(visningRingAtom).length > 0 && get(focusedHalfAtom) === 'a',
);

/*
 * And the label that says so, on both sides of the handover.
 *
 * The four dataset pulldowns advertise their ring in their own heading
 * ("LiDAR-datasett · W/S") and one of them — Terreng's — only ever renders
 * inside a lokalitet, i.e. exactly where the keys may have gone. A heading
 * that promises a shortcut which swaps the ground for a 1937 ortofoto instead
 * is worse than no heading, so the suffix is composed rather than translated:
 * the hint moves with the keys, and there is one string to keep in three
 * languages instead of five.
 */
const RING_HINT = ' · W/S';

/** For the four ground dataset pulldowns: the hint, unless it has moved. */
export const useGroundRingHint = () =>
  useAtomValue(visningRingHasKeysAtom) ? '' : RING_HINT;

/** For `[Visning ▾]`'s pulldown: the hint, once there is a ring to walk. */
export const useVisningRingHint = () =>
  useAtomValue(visningRingHasKeysAtom) ? RING_HINT : '';

/**
 * Step the ring. Returns whether it was walked at all, so the caller can fall
 * through to the ground's own dataset ring when there is nothing to walk.
 *
 * `ring.length + 1` stops, because the first one is **no View at all** — the
 * bare ground, which is where a lokalitet opens unless its cover is a pinned
 * View, and which you have to be able to get back to without opening the
 * pulldown. Exactly one View is up at any other stop: the ring is a ring, and
 * composing several is what the switches are for.
 *
 * Where the ring is *standing* is read off the switches rather than kept in a
 * state of its own — a second copy of "what is on the ground" would be a
 * second answer the moment somebody used the pulldown. A hand-composed stack
 * of three therefore collapses to one on the next press, from the topmost of
 * them, which is the only reading that makes the following press move up.
 *
 * Walking switches the group on. A ring whose every stop is held down is the
 * "feels broken" case §5.3 names for the LiDAR pin, and the group label is a
 * hold rather than a choice about members (§10.1) — so putting it back takes
 * nothing away.
 */
export const cycleVisningAtom = atom(
  null,
  (get, set, step: 1 | -1): boolean => {
    // The same predicate the four headings read, rather than the two tests
    // written out again here: a ring that walks where the label says it does
    // not is the failure this whole hint mechanism exists to avoid.
    if (!get(visningRingHasKeysAtom)) return false;
    const ring = get(visningRingAtom);

    const shown = get(visningShownAtom);
    let at = 0;
    ring.forEach((id, i) => {
      if (shown.has(id)) at = i + 1;
    });

    const stops = ring.length + 1;
    const next = (at + step + stops) % stops;
    set(
      visningShownAtom,
      next === 0 ? new Set<string>() : new Set([ring[next - 1]]),
    );
    set(visningGroupShownAtom, true);
    // Walking the ring is the group taken in hand, so the arrival cover is no
    // longer the app's guess — including the stop that walked *off* it. Set
    // directly rather than through `spendProvisionalViewAtom`: the shown set
    // has just been replaced wholesale, so there is nothing left to withdraw.
    set(provisionalViewAtom, null);
    return true;
  },
);
