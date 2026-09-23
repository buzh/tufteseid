import { useCallback, useEffect, useState } from 'react';

import { pb } from '../api/pocketbase';

export type OAuthProvider = { name: string; displayName: string };

// A property of the deployment, not the session, so cached for the page's life.
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
        cachedProviders = methods.oauth2.providers;
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

// The SDK's all-in-one popup flow, bouncing through /pb/api/oauth2-redirect.
export const useSignIn = () =>
  useCallback(async (providerName: string) => {
    await pb.collection('users').authWithOAuth2({ provider: providerName });
  }, []);

export const useSignOut = () =>
  useCallback(() => {
    pb.authStore.clear();
  }, []);
