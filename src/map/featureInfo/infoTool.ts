import { atom } from 'jotai';
import { funnSessionAtom } from '../../funn/session';
import { selectedResultAtom } from '../../search/atoms';
import { mapToolAtom } from '../overlay/atoms';
import { featureInfoPanelOpenAtom } from './atoms';

// Stedsinfo — the point readout, armed from the ribbon and off on arrival. Its
// own module because the armed atom has to see the two other click owners, and
// the pen's module graph reaches back to `featureInfo/atoms`.
const infoToolStateAtom = atom(false);

/** The button and the I key. Writing `false` puts away the coordinate readout,
 * but not the Kulturminner popup and not a search result. */
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
 * Nobody else owns the click: measure and the pen want the same one and OL will
 * hand it to all three. Suspension rather than disarming, so leaving measure
 * puts the readout back. This is also the whole gate on the Kulturminner popup,
 * which answers whether or not Stedsinfo is armed.
 */
export const heritageClickArmedAtom = atom(
  (get) => get(mapToolAtom) !== 'measure' && get(funnSessionAtom) == null,
);

/** What the point readout reads: the tool is on and nobody else has the click. */
export const infoClickArmedAtom = atom(
  (get) => get(infoToolStateAtom) && get(heritageClickArmedAtom),
);
