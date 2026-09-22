import { useCallback, useEffect, useState } from 'react';

import { pb } from '../api/pocketbase';

export type OAuthProvider = { name: string; displayName: string };

// Which providers exist is a property of the deployment, not of the session:
// adding one is an admin-UI change on the `users` collection. Cached in a
// module variable so opening the dialog twice asks once.
let cachedProviders: OAuthProvider[] | null = null;

export const useOAuthProviders = () => {
  const [providers, setProviders] = useState<OAuthProvider[] | null>(
    cachedProviders,
  );
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (cachedProviders) return;
    let live = true;
    pb.collection('users')
      .listAuthMethods()
      .then((methods) => {
        cachedProviders = methods.oauth2.providers;
        if (live) setProviders(cachedProviders);
      })
      .catch((err) => {
        if (live) setError(err);
      });
    return () => {
      live = false;
    };
  }, []);

  return { providers, error };
};

/** The SDK's all-in-one popup flow, bouncing through /pb/api/oauth2-redirect. */
export const useSignIn = () =>
  useCallback(async (providerName: string) => {
    await pb.collection('users').authWithOAuth2({ provider: providerName });
  }, []);

export const useSignOut = () =>
  useCallback(() => {
    pb.authStore.clear();
  }, []);
