// OAuth2 only: this lists whatever `listAuthMethods()` reports, labelled with
// the `displayName` set in PocketBase's admin UI (Collections -> users ->
// Options -> OAuth2). Not the sign-in form — pressing a provider hands the
// page over to its own, and `src/auth/trip.ts` picks the session up on the
// way back. The box is where the reader is told why an account is wanted and
// where an invite code is asked for, both of which have to happen before they
// are somewhere else.

import {
  Alert,
  Button,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useAtom } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { bootInviteCode, forgetInviteLink } from '../invites/inviteLink';
import {
  authPromptAtom,
  isAuthDialogOpenAtom,
  signInFailedAtom,
  signInRefusalAtom,
} from './atoms';
import styles from './AuthDialog.module.css';
import { useOAuthProviders, useRegistrationGate } from './hooks';
import { startSignIn } from './trip';

export const AuthDialog = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useAtom(isAuthDialogOpenAtom);
  const [prompt, setPrompt] = useAtom(authPromptAtom);
  const [failed, setFailed] = useAtom(signInFailedAtom);
  const [refusal, setRefusal] = useAtom(signInRefusalAtom);
  const { providers, failed: providersFailed } = useOAuthProviders();
  const gate = useRegistrationGate(open);
  // Seeded from the link the reader followed, or from the code the gate just
  // turned down so a typo can be corrected where it was made.
  const [invite, setInvite] = useState(bootInviteCode || refusal?.invite || '');
  // Which provider the page is on its way to. Composing the authorize URL is
  // a round trip of its own, and a second press would spend a second `state`.
  const [leaving, setLeaving] = useState<string | null>(null);

  // Dismissing is the reader saying they are done with the invitation link
  // they arrived on, so the parameter goes: leaving it would put the box up
  // again on the next reload.
  const close = () => {
    forgetInviteLink();
    setOpen(false);
    setPrompt(null);
    setFailed(false);
    setRefusal(null);
  };

  const leave = (provider: string) => {
    // Before `startSignIn`, which stashes `window.location.href` as the
    // address to come back to: the code is in the stash by then, and finding
    // it on the URL again afterwards would reopen the box over a session the
    // reader just got.
    forgetInviteLink();
    setFailed(false);
    setRefusal(null);
    setLeaving(provider);
    void startSignIn(provider, invite.trim()).catch((err: unknown) => {
      console.warn('[auth] could not start sign-in', err);
      setLeaving(null);
      setFailed(true);
    });
  };

  // The gate itself while it is shut, null otherwise — including on an
  // installation that has none, where the box reads as it always did.
  const beta = gate?.closed ? gate : null;

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

        {prompt === 'inviteLink' && (
          <Alert color="yellow">{t('auth.beta.invited')}</Alert>
        )}

        <Text size="sm" c="dimmed">
          {t('auth.blurb')}
        </Text>

        {/* Not to somebody who arrived on an invitation: a code is a way in
            of its own and never looks at the free places, so how many are
            left is nothing to do with them — and "they are all taken" reads
            as a refusal. */}
        {beta && prompt !== 'inviteLink' && (
          <Alert color="yellow">
            {beta.openSlots > 0
              ? t('auth.beta.slots', { count: beta.openSlots })
              : t('auth.beta.full')}
          </Alert>
        )}

        {refusal?.reason === 'registrationClosed' && (
          <Alert color="red">{t('auth.beta.refusedClosed')}</Alert>
        )}

        {refusal?.reason === 'inviteInvalid' && (
          <Alert color="red">{t('auth.beta.refusedCode')}</Alert>
        )}

        {providersFailed && (
          <Alert color="red">{t('auth.providersError')}</Alert>
        )}

        {failed && !refusal && (
          <Alert color="red">{t('auth.signInFailed')}</Alert>
        )}

        {/* Also on a refusal: if reading the gate is what failed, this is
            the only way an invited reader could get in. */}
        {(beta || refusal) && (
          <TextInput
            label={t('auth.beta.codeLabel')}
            description={t('auth.beta.codeHelp')}
            placeholder={t('auth.beta.codePlaceholder')}
            value={invite}
            onChange={(event) => setInvite(event.currentTarget.value)}
            disabled={leaving !== null}
          />
        )}

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
