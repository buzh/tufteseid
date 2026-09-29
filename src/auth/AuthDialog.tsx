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
// the app is the `formCss` on Casdoor's application, which is typed into its
// console per host (docs/identity.md) — the frame is cross-origin and no style
// here reaches inside it.

import {
  Alert,
  Anchor,
  Button,
  Loader,
  Modal,
  Stack,
  Text,
} from '@mantine/core';
import { useAtom } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authPromptAtom, isAuthDialogOpenAtom } from './atoms';
import styles from './AuthDialog.module.css';
import { useOAuthProviders, useSignIn } from './hooks';

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
        // A retry clears the last failure when its form arrives rather than
        // when it is asked for: the box starts a trip from an effect, and
        // setting state before `authWithOAuth2` has been away to the network
        // would do it during that effect's render.
        await signIn(provider, (url) => {
          setSignInFailed(false);
          setFormUrl(url);
        });
        close();
      } catch (err) {
        console.warn('[auth] sign-in failed', err);
        setSignInFailed(true);
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
      size="md"
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
          <>
            <iframe
              className={styles.frame}
              src={formUrl}
              title={t('auth.formTitle')}
            />
            {/* A frame on a Casdoor that is not same-site with the app cannot
                keep its own cookies, and a browser may refuse it outright. The
                authorize URL is the same one either way, and so is the channel
                the code comes back on. */}
            <Anchor
              component="button"
              type="button"
              size="xs"
              onClick={() => window.open(formUrl, '_blank', 'noopener')}
            >
              {t('auth.openInWindow')}
            </Anchor>
          </>
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
