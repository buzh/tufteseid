import { atom } from 'jotai';

// How many src/ui/ overlays are open. The keyboard layers' [data-scope] walk
// only works while focus is inside the overlay; this is the check that does
// not depend on focus. Increment on open, decrement in the same cleanup.
export const overlayOpenCountAtom = atom(0);

export const anyOverlayOpenAtom = atom((get) => get(overlayOpenCountAtom) > 0);
