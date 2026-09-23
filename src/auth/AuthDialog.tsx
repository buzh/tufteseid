// OAuth2 only: this lists whatever `listAuthMethods()` reports. A provider is
// added in PocketBase's admin UI (Collections -> users -> Options -> OAuth2).

import { Alert, Button, Loader, Modal, Stack, Text } from '@mantine/core';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { authPromptAtom, isAuthDialogOpenAtom } from './atoms';
import { useOAuthProviders, useSignIn } from './hooks';

// PocketBase's `displayName` takes its casing from whoever configured the
// provider; these are the vendors' own spellings.
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
