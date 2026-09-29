import { useCallback, useEffect, useState } from 'react';

import { pb } from '../api/pocketbase';
import { endRemarkSession, resetRemarkSession } from '../api/remark42';

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
    // There is a Casdoor session now where the page may already have looked
    // and found none, so the threads get to ask again.
    resetRemarkSession();
  }, []);

// Both sessions, and remark42's first: the thread box re-creates the widget
// the moment the authStore changes, and a widget created while the cookie is
// still there shows the reader as signed in to a site they just left.
export const useSignOut = () =>
  useCallback(async () => {
    await endRemarkSession();
    pb.authStore.clear();
  }, []);
