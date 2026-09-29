import { useCallback, useEffect, useState } from 'react';

import { pb } from '../api/pocketbase';
import { endRemarkSession } from '../api/remark42';

export type OAuthProvider = { name: string; displayName: string };

// A property of the deployment, not the session, so cached for the page's
// life. Names and labels only: `listAuthMethods` also hands back a `state` and
// a PKCE verifier, and those belong to one trip rather than to the page, so
// `startSignIn` lists again rather than reading them here.
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

// Both sessions, and remark42's first: the thread box re-creates the widget
// the moment the authStore changes, and a widget created while the cookie is
// still there shows the reader as signed in to a site they just left.
export const useSignOut = () =>
  useCallback(async () => {
    await endRemarkSession();
    pb.authStore.clear();
  }, []);
