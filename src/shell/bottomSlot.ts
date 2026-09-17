import { atom } from 'jotai';

/*
 * Where the bottom edge renders. A slot rather than a component tree: the
 * surface belongs to the shell and `useLocalityWorkspace` is mounted from the
 * ribbon, on the opposite side of the tree, so the ribbon portals into the
 * element this atom publishes.
 *
 * One occupant at a time — filmstrip, edit carousel or picker run — because
 * everything here is over the map. `LocalityRibbon` decides which.
 */
export const bottomSlotAtom = atom<HTMLElement | null>(null);
