import { atom, useAtomValue } from 'jotai';

import type { SpotRecord } from '../api/spots';
import { currentUserAtom, isAdminAtom } from '../auth/atoms';

export const mayEditSpotAtom = atom((get) => {
  const user = get(currentUserAtom);
  const isAdmin = get(isAdminAtom);
  return (spot: SpotRecord | null): boolean =>
    user != null && spot != null && (user.id === spot.owner || isAdmin);
});

export const useMayEditSpot = (spot: SpotRecord): boolean =>
  useAtomValue(mayEditSpotAtom)(spot);
