// Who owns which OL interaction.
//
// Interactions used to be located by scanning `map.getInteractions()` for
// an `instanceof` match, which turned that collection into one global
// namespace shared by every tool. Five of them add the same classes: the
// draw tool (Draw/Select/Translate/Modify/Snap), measure (Draw), "Ny
// lokalitet" (Draw), "Juster området" (Translate/Modify) and the LiDAR
// extract (Draw). So "remove every Draw" in one tool silently detached
// another tool's, and `getDrawInteraction()` returned whichever Draw
// happened to be first in the collection.
//
// Tagging on the way in and filtering on the way out keeps each tool
// looking only at its own.

import type Interaction from 'ol/interaction/Interaction';
import type Map from 'ol/Map';

export type InteractionOwner =
  | 'draw'
  | 'measure'
  | 'localityCreate'
  | 'localityAdjust'
  | 'lidarExtract';

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

// Returns a fresh array. That matters: `getArray()` hands back the live
// array behind the Collection, and both it and `Collection#forEach` walk
// it by index with the length read up front — removing while iterating
// skips entries. Every caller here removes while iterating.
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
