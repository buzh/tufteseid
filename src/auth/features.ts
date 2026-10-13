import { atom, useAtomValue } from 'jotai';

import { serviceOn, type Service } from '../services';
import { currentUserAtom, isAdminAtom } from './atoms';

export type Feature = 'render' | 'flyfoto';

const SERVICE_OF: Record<Feature, Service> = {
  render: 'render',
  flyfoto: 'flyfoto',
};

const hasFeatureAtom = atom((get) => {
  const user = get(currentUserAtom);
  const isAdmin = get(isAdminAtom);
  return (feature: Feature): boolean =>
    serviceOn(SERVICE_OF[feature]) &&
    (isAdmin || (user?.features ?? []).includes(feature));
});

export const useHasFeature = (feature: Feature): boolean =>
  useAtomValue(hasFeatureAtom)(feature);
