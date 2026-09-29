// OAuth2 only: this lists whatever `listAuthMethods()` reports. A provider is
// added in PocketBase's admin UI (Collections -> users -> Options -> OAuth2),
// and in practice there is one — the `oidc` entry pointing at the Casdoor
// sidecar, which is also what the comment engine federates to. Its button
// text, for the installation that does have two, is the `displayName` set
// there.
//
// The box is the step before leaving rather than the form itself: pressing a
// provider hands the page over to its login page, and the session is picked up
// on the way back in (`src/auth/trip.ts`). Even with one provider and nothing
// to choose it earns the click, because saying why an account is wanted has to
// happen before the reader is somewhere else.

import { Alert, Button, Loader, Modal, Stack, Text } from '@mantine/core';
import { useAtom } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  authPromptAtom,
  isAuthDialogOpenAtom,
  signInFailedAtom,
} from './atoms';
import styles from './AuthDialog.module.css';
import { useOAuthProviders } from './hooks';
import { startSignIn } from './trip';

export const AuthDialog = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useAtom(isAuthDialogOpenAtom);
  const [prompt, setPrompt] = useAtom(authPromptAtom);
  const [failed, setFailed] = useAtom(signInFailedAtom);
  const { providers, failed: providersFailed } = useOAuthProviders();
  // Which provider the page is on its way to. Composing the authorize URL is
  // a round trip of its own, and a second press during it would spend a
  // second `state`.
  const [leaving, setLeaving] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setPrompt(null);
    setFailed(false);
  };

  const leave = (provider: string) => {
    setFailed(false);
    setLeaving(provider);
    void startSignIn(provider).catch((err: unknown) => {
      console.warn('[auth] could not start sign-in', err);
      setLeaving(null);
      setFailed(true);
    });
  };

  return (
    <Modal
      opened={open}
      onClose={close}
      title={t('auth.title')}
      closeButtonProps={{ className: styles.close }}
      centered
      size={420}
    >
      <Stack gap="sm">
        {prompt === 'spotLink' && (
          <Alert color="yellow">{t('spots.linkNeedsAccount')}</Alert>
        )}

        <Text size="sm" c="dimmed">
          {t('auth.blurb')}
        </Text>

        {providersFailed && (
          <Alert color="red">{t('auth.providersError')}</Alert>
        )}

        {failed && <Alert color="red">{t('auth.signInFailed')}</Alert>}

        {!providersFailed && providers == null && <Loader size="sm" />}

        {providers?.length === 0 && (
          <Alert color="yellow">{t('auth.noProviders')}</Alert>
        )}

        {providers?.map((provider) => (
          <Button
            key={provider.name}
            variant="default"
            loading={leaving === provider.name}
            disabled={leaving !== null && leaving !== provider.name}
            onClick={() => leave(provider.name)}
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
