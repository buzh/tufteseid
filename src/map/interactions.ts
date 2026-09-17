// Who owns which OL interaction: `map.getInteractions()` is one namespace and
// several tools add the same classes, so `instanceof` finds another tool's.

import type Interaction from 'ol/interaction/Interaction';
import type Map from 'ol/Map';

export type InteractionOwner =
  | 'draw'
  | 'measure'
  | 'localityAdjust'
  | 'localityPlace';

const OWNER_KEY = 'tufteseidOwner';

export const addOwnedInteraction = <T extends Interaction>(
  map: Map,
  owner: InteractionOwner,
  interaction: T,
): T => {
  interaction.set(OWNER_KEY, owner);
  map.addInteraction(interaction);
  return interaction;
};

// A fresh array, because `getArray()` hands back the Collection's live one and
// every caller here removes while iterating, which skips entries.
export const getOwnedInteractions = (
  map: Map,
  owner: InteractionOwner,
): Interaction[] =>
  map
    .getInteractions()
    .getArray()
    .filter((interaction) => interaction.get(OWNER_KEY) === owner);

export const removeOwnedInteractions = (
  map: Map,
  owner: InteractionOwner,
  filter?: (interaction: Interaction) => boolean,
) => {
  for (const interaction of getOwnedInteractions(map, owner)) {
    if (filter && !filter(interaction)) continue;
    map.removeInteraction(interaction);
  }
};
