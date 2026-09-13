import { atom } from 'jotai';
import { funnSessionAtom } from '../../funn/session';
import { selectedResultAtom } from '../../search/atoms';
import { mapToolAtom } from '../overlay/atoms';
import { featureInfoPanelOpenAtom } from './atoms';

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
 * Kept in its own module rather than in `atoms.ts` because the armed atom has
 * to see the two other click owners, and one of them (the pen) sits in a
 * module graph that reaches back to `featureInfo/atoms`.
 */
const infoToolStateAtom = atom(false);

/**
 * The button and the I key. Writing `false` also puts away whatever the
 * tool last produced: leaving a panel on screen after the tool that opened it
 * is gone means the only way to clear the map is to close two things in the
 * right order.
 *
 * The Kulturminner popup is **not** one of them any more. It is no longer the
 * tool's output — the overlay answers a click on its own (see
 * `heritageClickArmedAtom`) — so disarming Stedsinfo would be closing
 * somebody else's window. It has a close button of its own.
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
    set(featureInfoPanelOpenAtom, false);
    if (get(selectedResultAtom)?.type === 'Coordinate') {
      set(selectedResultAtom, null);
    }
  },
);

/**
 * Nobody else owns the click. Measure and the pen both want the same clicks,
 * and OL will happily hand one to all three. Suspension rather than disarming
 * — leaving measure or putting the pen down puts the readout back the way it
 * was found.
 *
 * The pen's arm is belt and braces since §9.2: the Excalidraw surface covers
 * the map, so a click never reaches OpenLayers while a session is up. It is
 * stated anyway because "nothing can reach the map" is a fact about a
 * stylesheet, and this atom is about who owns the gesture.
 *
 * It is also, on its own, the whole gate on **the Kulturminner popup**: a
 * click on a heritage feature that is on the map answers whether or not
 * Stedsinfo is armed. Switching the overlay on is already the act of asking
 * for the heritage record, and making the answer wait on a second, differently
 * named tool is two controls for one surface — the failure
 * `docs/ui-architecture.md` §1 is about. What stays behind the tool is the
 * part the overlay did not ask for: the coordinate marker, the elevation
 * readout and the InfoBox, i.e. the interrogation of every register at a point
 * nobody said was interesting.
 */
export const heritageClickArmedAtom = atom(
  (get) => get(mapToolAtom) !== 'measure' && get(funnSessionAtom) == null,
);

/**
 * What the point readout reads: the tool is on, and nobody else owns the
 * click.
 */
export const infoClickArmedAtom = atom(
  (get) => get(infoToolStateAtom) && get(heritageClickArmedAtom),
);
