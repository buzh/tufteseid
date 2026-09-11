import { atom } from 'jotai';

/*
 * Where the bottom edge renders — docs/lokalitet-view.md §4.3.
 *
 * A slot rather than a component tree: the surface belongs to the shell, the
 * controller behind it (`useLocalityWorkspace`) is mounted exactly once from
 * the ribbon, and the two are on opposite sides of the tree. The ribbon
 * portals into the element this atom publishes.
 *
 * There was a `dockSlot.ts` beside this doing the same thing for the right
 * column. It is gone with the dock, and this is where its contents landed —
 * §6 calls that a move rather than a deletion.
 *
 * The slot holds **one** occupant at a time (§4.3): the filmstrip, the edit
 * carousel, a picker run, or the draw bar while a funn draft is open. Nothing
 * stacks here, because everything here is over the map. Which one it is, is
 * decided in `LocalityRibbon`.
 */
export const bottomSlotAtom = atom<HTMLElement | null>(null);
