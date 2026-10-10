import { atom, useAtomValue } from 'jotai';

import { serviceOn, type Service } from '../services';
import { currentUserAtom, isAdminAtom } from './atoms';

/**
 * What an account may spend, beyond what every signed-in reader may.
 *
 * Each name is a Casdoor permission, held through whichever tier roles its
 * console lists on it and mirrored onto the user row at sign-in
 * (`docs/identity.md`). So the tiers are not here and never will be: this side
 * knows only that something is gated, not who is on the right side of it.
 *
 * Nothing gated here is enforced here. `render` is the sidecar's to refuse
 * (`docs/render-sidecar.md`); hiding the controls that would ask is a courtesy
 * to a reader who would only meet a 403 — or, on an installation that does not
 * run the sidecar at all, a 502.
 */
export type Feature = 'render';

/** Which sidecar each one spends. Nobody holds a feature on an installation
 *  that does not run the service behind it (`src/services.ts`). */
const SERVICE_OF: Record<Feature, Service> = { render: 'render' };

/** An administrator holds every feature, the way they may edit every spot.
 *  `rendersvc` says the same, so the two ends cannot disagree. */
const hasFeatureAtom = atom((get) => {
  const user = get(currentUserAtom);
  const isAdmin = get(isAdminAtom);
  return (feature: Feature): boolean =>
    serviceOn(SERVICE_OF[feature]) &&
    (isAdmin || (user?.features ?? []).includes(feature));
});

export const useHasFeature = (feature: Feature): boolean =>
  useAtomValue(hasFeatureAtom)(feature);
