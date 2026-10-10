// Email and password against our own PocketBase, in three modes on one form:
// signing in, making an account, and asking for a reset letter
// (`docs/identity.md`). The invite code is asked for here because this is the
// only place the closed beta can be paid (`docs/closed-beta.md`).

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
import { useRegistrationGate } from './hooks';
import {
  badFields,
  refusalOf,
  register,
  requestPasswordReset,
  signIn,
} from './session';

type Mode = 'signIn' | 'register' | 'reset';

// Spelled out rather than composed from `mode`, so every key is one grep away
// in `src/locales/nb/translation.json`.
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

/** Which locale key says what went wrong. The closed beta's two refusals are
 *  named; past those only the field PocketBase refused is worth reporting,
 *  and a sign-in is told apart from a registration because the same 400
 *  means a wrong password on one and an address already taken on the other. */
const messageFor = (err: unknown, mode: Mode): string => {
  const refusal = refusalOf(err);
  if (refusal === 'registrationClosed') return 'auth.beta.refusedClosed';
  if (refusal === 'inviteInvalid') return 'auth.beta.refusedCode';

  const status = (err as { status?: number })?.status;
  if (status !== 400) return 'auth.failed';
  if (mode === 'signIn') return 'auth.wrongPassword';
  // The reset route answers 204 for an address nobody holds, so its only 400
  // is one the field itself would not take.
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

  // A reader who followed an invitation link is making an account by
  // definition, so the box opens on that half of the form.
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

  // Dismissing is the reader saying they are done with the invitation link
  // they arrived on, so the parameter goes: leaving it would put the box up
  // again on the next reload.
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

  // The gate itself while it is shut, null otherwise — including on an
  // installation that has none, where the box reads as it always did.
  const beta = gate?.closed ? gate : null;

  const registering = mode === 'register';
  // The gate's own two refusals, which are the one case where the code field
  // has to appear whatever the gate said — including when reading it is what
  // failed, since then nothing else would let an invited reader in.
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

          {/* Not to somebody who arrived on an invitation: a code is a way in
              of its own and never looks at the free places, so how many are
              left is nothing to do with them — and "they are all taken" reads
              as a refusal. */}
          {beta && registering && prompt !== 'inviteLink' && (
            <Alert color="yellow">
              {beta.openSlots > 0
                ? t('auth.beta.slots', { count: beta.openSlots })
                : t('auth.beta.full')}
            </Alert>
          )}

          {error && <Alert color="red">{t(error)}</Alert>}

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
