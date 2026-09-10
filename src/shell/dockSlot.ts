import { atom } from 'jotai';

/*
 * Where the lokalitet dock renders.
 *
 * The dock belongs to the shell's right-hand slot, but the controller behind
 * it — `useLocalityWorkspace` — must be mounted exactly once, and the ribbon's
 * lokalitet row needs the same instance. Rather than hoist an 850-line hook
 * to a common ancestor and make every one of its callbacks nullable, the row
 * keeps the mount and portals the dock into this element: one React tree, two
 * places in the DOM.
 *
 * An atom rather than a DOM id lookup so there is no order-of-mount race —
 * the slot publishes itself through a ref callback, and the portal simply
 * does not render until it has.
 */
export const dockSlotAtom = atom<HTMLElement | null>(null);
