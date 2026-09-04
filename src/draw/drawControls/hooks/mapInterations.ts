import { getDefaultStore } from 'jotai';
import Draw from 'ol/interaction/Draw';
import Select from 'ol/interaction/Select';
import { mapAtom } from '../../../map/atoms';
import { getOwnedInteractions } from '../../../map/interactions';

// Scoped to the draw tool. The map carries Draw and Translate
// interactions belonging to measure, "Ny lokalitet", "Juster området"
// and the LiDAR extract as well, so an unscoped `instanceof` scan picks
// up whichever was added first.
const drawInteractions = () =>
  getOwnedInteractions(getDefaultStore().get(mapAtom), 'draw');

export const getSelectInteraction = () =>
  drawInteractions().find((i): i is Select => i instanceof Select);

export const getDrawInteraction = () =>
  drawInteractions().find((i): i is Draw => i instanceof Draw);
