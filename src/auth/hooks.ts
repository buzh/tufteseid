import { useCallback, useEffect, useState } from 'react';

import { getRegistrationGate, type RegistrationGate } from '../api/invites';
import { pb } from '../api/pocketbase';
import { endRemarkSession } from '../api/remark42';
import { endCasdoorSession } from './casdoor';

export type OAuthProvider = { name: string; displayName: string };

// A property of the deployment, not the session, so cached for the page's
// life. Names and labels only — the `state` and PKCE verifier that come with
// them belong to one trip, so `startSignIn` lists again for its own.
let cachedProviders: OAuthProvider[] | null = null;

export const useOAuthProviders = () => {
  const [providers, setProviders] = useState<OAuthProvider[] | null>(
    cachedProviders,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (cachedProviders) return;
    let live = true;
    pb.collection('users')
      .listAuthMethods()
      .then((methods) => {
        cachedProviders = methods.oauth2.providers.map(
          ({ name, displayName }) => ({ name, displayName }),
        );
        if (live) setProviders(cachedProviders);
      })
      .catch((err) => {
        console.warn('[auth] listing providers failed', err);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  return { providers, failed };
};

/** The closed beta's state, re-read each time the box opens rather than
 *  cached like the provider list: free places are taken while the page is up.
 *  Null is "not known" — an installation whose `registration` row is missing
 *  gates nothing and says nothing. */
export const useRegistrationGate = (open: boolean) => {
  const [gate, setGate] = useState<RegistrationGate | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    getRegistrationGate()
      .then((row) => {
        if (live) setGate(row);
      })
      .catch((err) => {
        console.warn('[auth] reading the registration gate failed', err);
      });
    return () => {
      live = false;
    };
  }, [open]);

  return gate;
};

// All three sessions, and the app's own last: the thread box re-creates the
// widget the moment the authStore changes, and one created while remark42's
// cookie is still there shows the reader as signed in to a site they just
// left. Casdoor's goes in the same breath rather than after it — unrelated
// round trips, and a sign-out should be one wait (`docs/identity.md`).
export const useSignOut = () =>
  useCallback(async () => {
    await Promise.all([endRemarkSession(), endCasdoorSession()]);
    pb.authStore.clear();
  }, []);
