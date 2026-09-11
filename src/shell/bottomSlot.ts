import { atom } from 'jotai';

/*
 * Where the bottom edge renders — docs/lokalitet-view.md §4.3.
 *
 * Same mechanism as `dockSlot.ts`, and for the same reason: the surface
 * belongs to the shell, the controller behind it (`useLocalityWorkspace`) is
 * mounted exactly once from the ribbon, and the two are on opposite sides of
 * the tree. The ribbon portals into the element this atom publishes.
 *
 * A second atom rather than a reused one because the two slots are live at
 * the same time until step 12 removes the dock. When that happens this is the
 * one that survives; §6 calls the dock's disappearance a move rather than a
 * deletion, and this file is the destination.
 *
 * The slot holds **one** occupant at a time (§4.3): the filmstrip, the edit
 * carousel, or the draw toolbar while a funn draft is open. Nothing stacks
 * here, because everything here is over the map.
 */
export const bottomSlotAtom = atom<HTMLElement | null>(null);
