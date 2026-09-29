// OAuth2 only: this lists whatever `listAuthMethods()` reports. A provider is
// added in PocketBase's admin UI (Collections -> users -> Options -> OAuth2),
// and in practice there is one — the `oidc` entry pointing at the Casdoor
// sidecar, which is also what the comment engine federates to. With a single
// provider there is nothing to choose, so the box goes straight to the form
// rather than asking the reader to press its name first. Its button text, for
// the installation that does have two, is the `displayName` set there.
//
// The form itself is Casdoor's, framed rather than opened in a popup: the code
// comes back over PocketBase's realtime channel, so the round trip does not
// care whether it happened in a window. What makes it look like the rest of
// the app is a theme and a stylesheet typed into Casdoor's console per host
// (docs/identity.md), plus the `?theme=dark` below — the frame is
// cross-origin, so no style here reaches inside it, and Casdoor skips its own
// Form CSS field when it is framed.

import { Alert, Button, Loader, Modal, Stack, Text } from '@mantine/core';
import { useAtom } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authPromptAtom, isAuthDialogOpenAtom } from './atoms';
import styles from './AuthDialog.module.css';
import { useOAuthProviders, useSignIn } from './hooks';

// Casdoor picks its light or dark algorithm from `?theme=`, falling back to
// whatever the last visit left in that origin's localStorage and then to
// light. Its application theme does not come into it — that carries the
// colours only — so without this the frame is a white form with a papaya
// button in it. The parameter also persists, which is why the Casdoor
// console goes dark for whoever signs in here.
const darkened = (url: string): string => {
  const themed = new URL(url);
  themed.searchParams.set('theme', 'dark');
  return themed.toString();
};

// A trip lives exactly as long as the realtime connection it listens on, and
// the drop is fatal rather than survivable: the subscription's client id is
// the OAuth2 `state`, so a reconnected one is a stranger to the authorize URL
// already in the frame. Rather than leave the reader looking at a form that
// can no longer answer, the box spends another trip on a fresh URL — up to a
// point, past which it says so instead of hammering a backend that is down.
// What makes this worth having at all is that the connection is not the app's
// to keep alive (docs/identity.md).
const MAX_TRIPS = 3;

export const AuthDialog = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useAtom(isAuthDialogOpenAtom);
  const [prompt, setPrompt] = useAtom(authPromptAtom);
  const { providers, failed } = useOAuthProviders();
  const signIn = useSignIn();
  const [formUrl, setFormUrl] = useState<string | null>(null);
  const [signInFailed, setSignInFailed] = useState(false);
  // The round trip outlives the box. Closing it abandons neither the OAuth2
  // state nor the promise waiting on the realtime channel, so reopening puts
  // the same authorize URL back in the frame instead of starting a second one.
  const inFlight = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    setPrompt(null);
  }, [setOpen, setPrompt]);

  const start = useCallback(
    async (provider: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        for (let trip = 1; trip <= MAX_TRIPS; trip++) {
          try {
            // A retry clears the last failure when its form arrives rather
            // than when it is asked for: the box starts a trip from an
            // effect, and setting state before `authWithOAuth2` has been away
            // to the network would do it during that effect's render.
            await signIn(provider, (url) => {
              setSignInFailed(false);
              setFormUrl(darkened(url));
            });
            close();
            break;
          } catch (err) {
            console.warn('[auth] sign-in failed', err);
            if (trip === MAX_TRIPS) setSignInFailed(true);
          }
        }
      } finally {
        inFlight.current = false;
        setFormUrl(null);
      }
    },
    [close, signIn],
  );

  const only = providers?.length === 1 ? providers[0].name : null;

  useEffect(() => {
    // The rule's own advice — set the state from the event instead — has
    // nowhere to go here: the event is the box opening, the state is an
    // authorize URL that exists a network round trip later, and four call
    // sites open this box.
    // eslint-disable-next-line react/set-state-in-effect
    if (open && only) void start(only);
  }, [only, open, start]);

  return (
    <Modal
      opened={open}
      onClose={close}
      title={t('auth.title')}
      closeButtonProps={{ className: styles.close }}
      centered
      size="sm"
    >
      <Stack gap="sm">
        {prompt === 'spotLink' && (
          <Alert color="yellow">{t('spots.linkNeedsAccount')}</Alert>
        )}

        <Text size="sm" c="dimmed">
          {t('auth.blurb')}
        </Text>

        {failed && <Alert color="red">{t('auth.providersError')}</Alert>}

        {signInFailed && <Alert color="red">{t('auth.signInFailed')}</Alert>}

        {!failed && providers == null && <Loader size="sm" />}

        {providers?.length === 0 && (
          <Alert color="yellow">{t('auth.noProviders')}</Alert>
        )}

        {formUrl && (
          <iframe
            className={styles.frame}
            src={formUrl}
            title={t('auth.formTitle')}
          />
        )}

        {/* Nothing to choose from when there is one provider — the effect
            above has already started it. After a failure the list comes back
            even then, because pressing a provider is also how it is retried. */}
        {!formUrl &&
          (signInFailed || !only) &&
          providers?.map((provider) => (
            <Button
              key={provider.name}
              variant="default"
              onClick={() => void start(provider.name)}
            >
              {t('auth.signInWith', {
                provider: provider.displayName || provider.name,
              })}
            </Button>
          ))}
      </Stack>
    </Modal>
  );
};
