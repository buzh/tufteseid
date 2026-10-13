

import {
  Alert,
  Anchor,
  Button,
  Group,
  Modal,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useAtom } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { bootInviteCode, forgetInviteLink } from '../invites/inviteLink';
import { authPromptAtom, isAuthDialogOpenAtom } from './atoms';
import styles from './AuthDialog.module.css';
import { useCapacity, useRegistrationGate } from './hooks';
import {
  badFields,
  refusalOf,
  register,
  requestPasswordReset,
  signIn,
} from './session';

type Mode = 'signIn' | 'register' | 'reset';

const COPY: Record<Mode, { title: string; blurb: string; submit: string }> = {
  signIn: { title: 'auth.title', blurb: 'auth.blurb', submit: 'auth.signIn' },
  register: {
    title: 'auth.registerTitle',
    blurb: 'auth.registerBlurb',
    submit: 'auth.registerSubmit',
  },
  reset: {
    title: 'auth.resetTitle',
    blurb: 'auth.resetBlurb',
    submit: 'auth.resetSubmit',
  },
};

const messageFor = (err: unknown, mode: Mode): string => {
  const refusal = refusalOf(err);
  if (refusal === 'registrationClosed') return 'auth.beta.refusedClosed';
  if (refusal === 'inviteInvalid') return 'auth.beta.refusedCode';
  if (refusal === 'queued') return 'auth.cap.queued';

  const status = (err as { status?: number })?.status;
  if (status !== 400) return 'auth.failed';
  if (mode === 'signIn') return 'auth.wrongPassword';

  if (mode === 'reset') return 'auth.emailInvalid';

  const fields = badFields(err);
  if (fields.includes('password')) return 'auth.passwordTooShort';
  if (fields.includes('email')) return 'auth.emailTaken';
  return 'auth.failed';
};

export const AuthDialog = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useAtom(isAuthDialogOpenAtom);
  const [prompt, setPrompt] = useAtom(authPromptAtom);
  const gate = useRegistrationGate(open);
  const capacity = useCapacity(open);

  const [mode, setMode] = useState<Mode>(
    bootInviteCode ? 'register' : 'signIn',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState(bootInviteCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const close = () => {
    forgetInviteLink();
    setOpen(false);
    setPrompt(null);
  };

  const go = (next: Mode) => {
    setMode(next);
    setError(null);
    setSent(false);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'reset') {
        await requestPasswordReset(email.trim());
        setSent(true);
        return;
      }
      if (mode === 'signIn') {
        await signIn(email.trim(), password);
      } else {
        await register({
          email: email.trim(),
          password,
          name: name.trim(),
          invite: invite.trim(),
        });
      }
      close();
    } catch (err) {
      console.warn('[auth] sign-in failed', err);
      setError(messageFor(err, mode));
    } finally {
      setBusy(false);
    }
  };

  const beta = gate?.closed ? gate : null;

  const cap = capacity && capacity.max > 0 ? capacity : null;
  const full = cap != null && cap.users >= cap.max;

  const registering = mode === 'register';

  const refused =
    error === 'auth.beta.refusedClosed' || error === 'auth.beta.refusedCode';
  const enough =
    email.trim() !== '' && (mode === 'reset' || password !== '') && !busy;

  return (
    <Modal
      opened={open}
      onClose={close}
      title={t(COPY[mode].title)}
      closeButtonProps={{ className: styles.close }}
      centered
      size={420}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (enough) void submit();
        }}
      >
        <Stack gap="sm">
          {prompt === 'spotLink' && (
            <Alert color="yellow">{t('spots.linkNeedsAccount')}</Alert>
          )}

          {prompt === 'inviteLink' && (
            <Alert color="yellow">{t('auth.beta.invited')}</Alert>
          )}

          <Text size="sm" c="dimmed">
            {t(COPY[mode].blurb)}
          </Text>

          {}
          {beta && registering && prompt !== 'inviteLink' && (
            <Alert color="yellow">
              {beta.openSlots > 0
                ? t('auth.beta.slots', { count: beta.openSlots })
                : t('auth.beta.full')}
            </Alert>
          )}

          {}
          {cap && registering && (
            <Text size="xs" c="dimmed">
              {t('shared.userCap', { count: cap.users, max: cap.max })}
            </Text>
          )}

          {full && registering && (
            <Alert color="yellow">{t('auth.cap.willQueue')}</Alert>
          )}

          {}
          {error && (
            <Alert color={error === 'auth.cap.queued' ? 'yellow' : 'red'}>
              {t(error)}
            </Alert>
          )}

          {sent && <Alert color="green">{t('auth.resetSent')}</Alert>}

          <TextInput
            label={t('auth.email')}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            disabled={busy}
          />

          {mode !== 'reset' && (
            <PasswordInput
              label={t('auth.password')}
              description={registering ? t('auth.passwordHelp') : undefined}
              autoComplete={registering ? 'new-password' : 'current-password'}
              required
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              disabled={busy}
            />
          )}

          {registering && (
            <TextInput
              label={t('auth.name')}
              description={t('auth.nameHelp')}
              autoComplete="nickname"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              disabled={busy}
            />
          )}

          {registering && (beta || refused) && (
            <TextInput
              label={t('auth.beta.codeLabel')}
              description={t('auth.beta.codeHelp')}
              placeholder={t('auth.beta.codePlaceholder')}
              value={invite}
              onChange={(event) => setInvite(event.currentTarget.value)}
              disabled={busy}
            />
          )}

          <Button type="submit" loading={busy} disabled={!enough}>
            {t(COPY[mode].submit)}
          </Button>

          <Group justify="space-between" gap="xs">
            <Anchor
              component="button"
              type="button"
              size="xs"
              onClick={() => go(registering ? 'signIn' : 'register')}
            >
              {t(registering ? 'auth.haveAccount' : 'auth.noAccount')}
            </Anchor>
            {mode !== 'reset' && (
              <Anchor
                component="button"
                type="button"
                size="xs"
                onClick={() => go('reset')}
              >
                {t('auth.forgot')}
              </Anchor>
            )}
          </Group>
        </Stack>
      </form>
    </Modal>
  );
};
