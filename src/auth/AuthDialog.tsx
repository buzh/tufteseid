// Signing in. One modal, mounted once at the top of the app, opened from the
// button in the band and from any verb that turns out to need an account.
//
// OAuth2 only, and there is no password form and no sign-up. Which providers
// exist is a property of the deployment — adding one is Collections → users →
// Options → OAuth2 in PocketBase's admin UI and no code change at all — so
// this lists whatever `listAuthMethods()` reports rather than carrying a menu
// that has to be kept in step with the server.

import { Alert, Button, Loader, Modal, Stack, Text } from '@mantine/core';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { authPromptAtom, isAuthDialogOpenAtom } from './atoms';
import { useOAuthProviders, useSignIn } from './hooks';

// PocketBase reports a provider's `displayName`, but its casing follows
// whoever configured it; these are the spellings the vendors use.
const PROVIDER_LABELS: Record<string, string> = {
  apple: 'Apple',
  github: 'GitHub',
  gitlab: 'GitLab',
  google: 'Google',
  microsoft: 'Microsoft',
  oidc: 'OIDC',
};

export const AuthDialog = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useAtom(isAuthDialogOpenAtom);
  const [prompt, setPrompt] = useAtom(authPromptAtom);
  const { providers, failed } = useOAuthProviders();
  const signIn = useSignIn();

  const close = () => {
    setOpen(false);
    setPrompt(null);
  };

  const handle = async (provider: string) => {
    try {
      await signIn(provider);
      close();
    } catch (err) {
      // Blocked popup, cancelled window, misconfigured provider. Nothing here
      // can tell them apart, and the reader can see the dialog is still up.
      console.warn('[auth] sign-in failed', err);
    }
  };

  return (
    <Modal
      opened={open}
      onClose={close}
      title={t('auth.title')}
      centered
      size="sm"
    >
      <Stack gap="sm">
        {/* Why it opened, when the reader did not press anything: a followed
            link that resolved to nothing they are allowed to see. */}
        {prompt === 'spotLink' && (
          <Alert color="yellow">{t('spots.linkNeedsAccount')}</Alert>
        )}

        <Text size="sm" c="dimmed">
          {t('auth.blurb')}
        </Text>

        {failed && <Alert color="red">{t('auth.providersError')}</Alert>}

        {!failed && providers == null && <Loader size="sm" />}

        {providers?.length === 0 && (
          <Alert color="yellow">{t('auth.noProviders')}</Alert>
        )}

        {providers?.map((provider) => (
          <Button
            key={provider.name}
            variant="default"
            onClick={() => void handle(provider.name)}
          >
            {t('auth.signInWith', {
              provider:
                PROVIDER_LABELS[provider.name] ??
                provider.displayName ??
                provider.name,
            })}
          </Button>
        ))}
      </Stack>
    </Modal>
  );
};
