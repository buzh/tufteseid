// OAuth2 only: this lists whatever `listAuthMethods()` reports. A provider is
// added in PocketBase's admin UI (Collections -> users -> Options -> OAuth2),
// and in practice there is one — the `oidc` entry pointing at the Casdoor
// sidecar, which is also what the comment engine federates to. Its button text
// is the `displayName` set there, so naming the provider is an admin's job
// rather than a table here.

import { Alert, Button, Loader, Modal, Stack, Text } from '@mantine/core';
import { useAtom } from 'jotai';
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
              provider: provider.displayName || provider.name,
            })}
          </Button>
        ))}
      </Stack>
    </Modal>
  );
};
