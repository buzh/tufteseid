import { atom, useAtomValue } from 'jotai';
import type { ViewSpec } from '../localities/viewSpec';
import { focusedHalfAtom } from '../map/compare/halves';
import {
  provisionalViewAtom,
  visningGroupShownAtom,
  visningShownAtom,
} from '../map/groundOverlay';
import { recreateViewAtom } from './useRecreateView';

/*
 * Choosing a View — the one entrance, for the pulldown and for W/S.
 *
 * `[Visning ▾]` shows **one View at a time**, and picking one *enters it*:
 * the ground it was rendered on, the dataset it named, the knobs it was made
 * with. Both halves of that are recent and both were asked for; between them
 * they turn the group from a set of checkboxes into what every other pulldown
 * in this app already is — a list of readings of one rectangle, with the one
 * you are looking at marked.
 *
 * **Why not several at once.** The group used to be multi-select on the
 * argument §13 deleted the one-slot arbiter for: an extract and a 1937
 * ortofoto, one faded over the other, is a comparison the map could not make
 * before. It is still a comparison worth making, and it is `Oppsett` and
 * `[Bilde ▾]` that make it now. What the checkboxes cost was the ordinary
 * case — a reader stepping through eight readings of one mound had to switch
 * the last one off before the next one meant anything, and a group that is
 * genuinely a ring everywhere else (W/S has always walked it one at a time)
 * was the only place in the app saying otherwise with its glyphs.
 *
 * **Why the ground comes with it.** A pulldown row that showed a pinned PNG
 * and left the ribbon saying "Standard" was a surface lying about what is on
 * screen: the settings strip described knobs nobody was looking at, `Behold`
 * offered to keep a ground that was not visible, and stepping W/S from a
 * terrain render to an ortofoto grab changed the picture without changing a
 * single control. So a selection is a `recreateViewAtom` as well —
 * `Gjenskap`, which used to be a separate button at the right edge of the
 * same row, doing the same thing on a second press nobody had a reason to
 * guess at.
 *
 * The cost is honest and is the reason it is one path rather than two: a step
 * of the ring can now enter Terreng and start a DEM fetch. Everything under
 * `useRecreateView` is cached per rectangle and the memo split in
 * `useTerrainAnalysis` keeps the sun knobs on the cheap side, so it is the
 * first step that pays.
 */

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

/** One row of `[Visning ▾]`, as the two things choosing it needs. */
export type VisningStop = {
  id: string;
  /**
   * What the map has to become to be showing this — `viewSpecOf`'s reading of
   * the record, carried here rather than looked up, because the ring is walked
   * from row 1 where the attachments are not.
   *
   * Null is reachable: a View whose `meta` no longer parses is still a row you
   * can select, it just cannot say what ground it was made on.
   */
  spec: ViewSpec | null;
};

/**
 * The Views `[Visning ▾]` lists, in the order the pulldown lists them — which
 * is the order they paint in, bottom to top. Empty whenever the group is not
 * on screen.
 */
export const visningRingAtom = atom<readonly VisningStop[]>([]);

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
 * Show one View, or none — every press and every keystroke goes through here.
 *
 * `null` is the group's other stop, the bare ground: no View over the
 * rectangle, the preset showing through it. It is a stop rather than the
 * absence of one because a reader who has walked into an image has to be able
 * to walk back out of it without hunting for a switch.
 *
 * Switching the group on is part of choosing a member. A choice whose every
 * outcome is held down is the "feels broken" case §5.3 names for the LiDAR
 * pin, and the group label is a hold rather than a statement about members
 * (§10.1) — so putting it back takes nothing away.
 */
export const selectVisningAtom = atom(
  null,
  (get, set, id: string | null) => {
    set(visningShownAtom, id == null ? new Set<string>() : new Set([id]));
    set(visningGroupShownAtom, true);
    // Saying which View you want is the group taken in hand, so the arrival
    // cover stops being the app's guess — including when what you asked for is
    // the stop that walks *off* it. Set directly rather than through
    // `spendProvisionalViewAtom`: the shown set has just been replaced
    // wholesale, so there is nothing left to withdraw.
    set(provisionalViewAtom, null);
    if (id == null) return;
    // And the ribbon follows. A stop with no readable spec still selects — the
    // pinned figure goes up and the ground is left where it was, which is the
    // same "absent, not disabled" the Gjenskap button used to make.
    const spec = get(visningRingAtom).find((stop) => stop.id === id)?.spec;
    if (spec) set(recreateViewAtom, spec);
  },
);

/**
 * Step the ring. Returns whether it was walked at all, so the caller can fall
 * through to the ground's own dataset ring when there is nothing to walk.
 *
 * `ring.length + 1` stops, the first being `selectVisning`'s `null`.
 *
 * Where the ring is *standing* is read off the shown set rather than kept in a
 * state of its own — a second copy of "what is on the ground" would be a
 * second answer the moment somebody used the pulldown. That reading survives
 * the one caller that can still put two Views up at once (`restoreScene`, for
 * a scene kept while the group was multi-select): the ring stands on the
 * topmost of them, which is the only reading that makes the following press
 * move up.
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
    ring.forEach((stop, i) => {
      if (shown.has(stop.id)) at = i + 1;
    });

    const stops = ring.length + 1;
    const next = (at + step + stops) % stops;
    set(selectVisningAtom, next === 0 ? null : ring[next - 1].id);
    return true;
  },
);
