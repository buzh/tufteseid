import { atom, useAtomValue } from 'jotai';

import type { SpotRecord } from '../api/spots';
import { currentUserAtom, isAdminAtom } from '../auth/atoms';

/** The one permission the UI carries, matching what the server enforces on
 *  update and delete: an admin may reshape anybody's spot. */
export const mayEditSpotAtom = atom((get) => {
  const user = get(currentUserAtom);
  const isAdmin = get(isAdminAtom);
  return (spot: SpotRecord | null): boolean =>
    user != null && spot != null && (user.id === spot.owner || isAdmin);
});

export const useMayEditSpot = (spot: SpotRecord): boolean =>
  useAtomValue(mayEditSpotAtom)(spot);
