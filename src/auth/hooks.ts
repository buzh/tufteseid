import { useCallback, useEffect, useState } from 'react';
import { pb } from '../api/pocketbase';

// Whatever the superuser enabled in the PB admin UI, cached per session. A
// structural subset of AuthProviderInfo; the rest is the manual OAuth2 flow.
export type OAuthProvider = {
  name: string;
  displayName: string;
};

let cachedProviders: OAuthProvider[] | null = null;

export const useOAuthProviders = () => {
  const [providers, setProviders] = useState<OAuthProvider[] | null>(
    cachedProviders,
  );
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (cachedProviders) return;
    let cancelled = false;
    pb.collection('users')
      .listAuthMethods()
      .then((methods) => {
        if (cancelled) return;
        cachedProviders = methods.oauth2.providers;
        setProviders(cachedProviders);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e as Error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { providers, error };
};

// On success pb.authStore updates and pbAuthSyncEffect carries it to the atom.
export const useSignIn = () => {
  return useCallback(async (providerName: string) => {
    await pb.collection('users').authWithOAuth2({ provider: providerName });
  }, []);
};

export const useSignOut = () => {
  return useCallback(() => {
    pb.authStore.clear();
  }, []);
};
