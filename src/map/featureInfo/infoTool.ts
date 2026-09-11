import { atom } from 'jotai';
import { selectedResultAtom } from '../../search/atoms';
import { drawEnabledAtom } from '../../settings/draw/atoms';
import { mapToolAtom } from '../overlay/atoms';
import { featureInfoPanelOpenAtom, kulturminnerPopupAtom } from './atoms';

/**
 * Stedsinfo — the point readout, and whether a map click asks for it.
 *
 * It used to be unconditional: every click on the map queried stedsnavn,
 * matrikkel, elevation and every visible WMS, dropped a marker and opened a
 * panel over the terrain. That makes the map's primary gesture a question
 * nobody asked — reading relief means clicking around constantly, panning
 * from a click, dismissing a click — so it is a tool now, armed from the
 * ribbon and **off on arrival**. Arm it, then click the point you actually
 * want to know about.
 *
 * Kept in its own module rather than in `atoms.ts` because the armed atom
 * has to see the two other click owners, and one of them (`drawEnabledAtom`)
 * sits in a module graph that reaches back to `featureInfo/atoms`.
 */
const infoToolStateAtom = atom(false);

/**
 * The button and the I key. Writing `false` also puts away whatever the
 * tool last produced: leaving a popup and a panel on screen after the tool
 * that opened them is gone means the only way to clear the map is to close
 * three things in the right order.
 *
 * A search result is left alone — the panel is its surface too, and the
 * search did not come from this tool. Only a coordinate readout, which
 * nothing but a map click can produce, goes with it.
 */
export const infoToolAtom = atom(
  (get) => get(infoToolStateAtom),
  (get, set, next: boolean) => {
    set(infoToolStateAtom, next);
    if (next) return;
    set(kulturminnerPopupAtom, null);
    set(featureInfoPanelOpenAtom, false);
    if (get(selectedResultAtom)?.type === 'Coordinate') {
      set(selectedResultAtom, null);
    }
  },
);

/**
 * What the two `singleclick` handlers read. Armed, and no other tool owns
 * the click: measure and funn drawing both want the same clicks, and OL will
 * happily hand a click to all three (`drawEnabledAtom` makes the same call
 * about measure). Suspension rather than disarming — leaving measure or
 * closing the draft puts the tool back the way it was found.
 */
export const infoClickArmedAtom = atom(
  (get) =>
    get(infoToolStateAtom) &&
    get(mapToolAtom) !== 'measure' &&
    !get(drawEnabledAtom),
);
