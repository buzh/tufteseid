import { atom, useAtomValue } from 'jotai';

import { pb, type SiteUser } from '../api/pocketbase';
import { serviceOn, type Service } from '../services';
import { currentUserAtom, isAdminAtom } from './atoms';

export type Feature = 'render' | 'flyfoto';

const SERVICE_OF: Record<Feature, Service> = {
  render: 'render',
  flyfoto: 'flyfoto',
};

const holds = (
  user: SiteUser | null,
  isAdmin: boolean,
  feature: Feature,
): boolean =>
  serviceOn(SERVICE_OF[feature]) &&
  (isAdmin || (user?.features ?? []).includes(feature));

const hasFeatureAtom = atom((get) => {
  const user = get(currentUserAtom);
  const isAdmin = get(isAdminAtom);
  return (feature: Feature): boolean => holds(user, isAdmin, feature);
});

export const useHasFeature = (feature: Feature): boolean =>
  useAtomValue(hasFeatureAtom)(feature);

export const featureHeldNow = (feature: Feature): boolean => {
  const user = (pb.authStore.record as SiteUser | null) ?? null;
  return holds(user, user?.role === 'admin', feature);
};
