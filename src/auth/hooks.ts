import { useCallback, useEffect, useState } from 'react';

import { pb } from '../api/pocketbase';
import { endRemarkSession } from '../api/remark42';

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

// remark42's session first: the thread box re-creates the widget the moment
// the authStore changes, and one created while the cookie is still there
// shows the reader as signed in to a site they just left.
export const useSignOut = () =>
  useCallback(async () => {
    await endRemarkSession();
    pb.authStore.clear();
  }, []);
