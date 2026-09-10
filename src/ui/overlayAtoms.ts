import { atom } from 'jotai';

/*
 * How many src/ui/ overlays (Popover, Dialog) are open right now.
 *
 * The keyboard layers in this app decide "does something else own the
 * keyboard?" by walking up from event.target for a [data-scope] attribute
 * (src/localities/useWorkspaceKeys.ts, src/map/useBackgroundCyclingKeys.ts).
 * That works for kvib/Ark, which portals to <body> and traps focus, so
 * event.target is always inside the overlay.
 *
 * Our primitives also portal and also move focus — but a future one that
 * forgets to would leave event.target === document.body and let A/D/W/S/E
 * or N/U/B leak through to the map. This counter is the second, cheaper
 * check that does not depend on where focus happens to be.
 *
 * Increment on open, decrement on close, always in the same effect cleanup.
 */
export const overlayOpenCountAtom = atom(0);

export const anyOverlayOpenAtom = atom((get) => get(overlayOpenCountAtom) > 0);
