// What a reader can do with the invites an administrator has granted them:
// mint one, copy its link, or have the backend mail it. The quota itself is
// granted by hand in SQL (docs/closed-beta.md) — nothing here hands one out.

import {
  ActionIcon,
  Alert,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createInvite,
  type InviteRecord,
  listMyInvites,
  revokeInvite,
  sendInvite,
} from '../api/invites';
import { currentUserAtom } from '../auth/atoms';
import { Icon } from '../ui/Icon';
import { isInvitesDialogOpenAtom } from './atoms';
import { inviteUrlOf } from './inviteLink';
import styles from './InvitesDialog.module.css';

const ANSWER_MS = 2000;

const validationCode = (err: unknown, field: 'email' | 'issuer'): string =>
  (err as { response?: { data?: Record<string, { code?: string }> } })?.response
    ?.data?.[field]?.code ?? '';

/** The hook tells a failed send apart from a refused one, so the reader
 *  learns whether it is their address, their budget or the installation at
 *  fault. */
const sendFailure = (err: unknown): string => {
  switch (validationCode(err, 'email')) {
    case 'mail_failed':
      return 'invites.mailFailed';
    case 'mail_budget_spent':
      return 'invites.budgetSpent';
    default:
      return 'invites.sendFailed';
  }
};

/** The quota only refreshes on the next page load, so a mint the hook refuses
 *  is the ordinary way for a stale count to be found out. */
const mintFailure = (err: unknown): string =>
  validationCode(err, 'issuer') === 'invite_quota_spent'
    ? 'invites.quotaSpent'
    : 'invites.mintFailed';

const InviteRow = ({
  invite,
  onChanged,
}: {
  invite: InviteRecord;
  onChanged: () => void;
}) => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), ANSWER_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const spent = invite.redeemedAt !== '';
  const sent = invite.sentAt !== '';

  const copy = () => {
    void navigator.clipboard
      .writeText(inviteUrlOf(invite.code))
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  // Cleared in `finally`, not in the catch: the row survives a successful
  // send — `onChanged` refetches rather than remounting it — and a row left
  // busy is one whose revoke button never comes back, which is the way out of
  // a mistyped address.
  const send = () => {
    setBusy(true);
    setFailure(null);
    sendInvite(invite.id, email.trim())
      .then(onChanged)
      .catch((err: unknown) => {
        console.warn('[invites] sending failed', err);
        setFailure(sendFailure(err));
      })
      .finally(() => setBusy(false));
  };

  const revoke = () => {
    setBusy(true);
    revokeInvite(invite.id)
      .then(onChanged)
      .catch((err: unknown) => {
        console.warn('[invites] revoking failed', err);
        setFailure('invites.revokeFailed');
      })
      .finally(() => setBusy(false));
  };

  const copyLabel = copied ? t('invites.copied') : t('invites.copy');

  return (
    <Stack gap={6} className={styles.invite}>
      <Group gap="xs" wrap="nowrap">
        <Code>{invite.code}</Code>
        <Tooltip label={copyLabel}>
          <ActionIcon variant="subtle" aria-label={copyLabel} onClick={copy}>
            <Icon icon={copied ? 'link' : 'content_copy'} size={16} />
          </ActionIcon>
        </Tooltip>
        {!spent && (
          <Tooltip label={t('invites.revoke')}>
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label={t('invites.revoke')}
              disabled={busy}
              onClick={revoke}
            >
              <Icon icon="delete" size={16} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>

      {spent ? (
        <Text size="xs" c="dimmed">
          {t('invites.spent')}
        </Text>
      ) : sent ? (
        <Text size="xs" c="dimmed">
          {t('invites.sentTo', { address: invite.email })}
        </Text>
      ) : (
        <Group gap="xs" wrap="nowrap">
          <TextInput
            size="xs"
            type="email"
            flex={1}
            placeholder={t('invites.emailPlaceholder')}
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
          <Button
            size="xs"
            variant="default"
            loading={busy}
            disabled={email.trim() === ''}
            onClick={send}
          >
            {t('invites.send')}
          </Button>
        </Group>
      )}

      {failure && (
        <Alert color="red" p="xs">
          {t(failure)}
        </Alert>
      )}
    </Stack>
  );
};

export const InvitesDialog = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useAtom(isInvitesDialogOpenAtom);
  const user = useAtomValue(currentUserAtom);
  const [invites, setInvites] = useState<InviteRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [minting, setMinting] = useState(false);
  const [mintFailed, setMintFailed] = useState<string | null>(null);

  const load = useCallback(
    () =>
      listMyInvites()
        .then((list) => {
          setInvites(list);
          setFailed(false);
        })
        .catch((err: unknown) => {
          console.warn('[invites] list failed', err);
          setFailed(true);
        }),
    [],
  );

  // Re-read on every opening, and leave the last list up while it lands: the
  // only way it changes behind the reader's back is somebody spending one.
  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  // The quota counts every invite ever minted, so revoking an unspent one
  // gives it back. Both halves of that subtraction are the server's; this is
  // only what the button needs to know.
  const left = (user?.inviteQuota ?? 0) - (invites?.length ?? 0);

  const mint = () => {
    if (!user) return;
    setMinting(true);
    setMintFailed(null);
    createInvite(user.id)
      .then(() => load())
      .catch((err: unknown) => {
        console.warn('[invites] minting failed', err);
        setMintFailed(mintFailure(err));
      })
      .finally(() => setMinting(false));
  };

  return (
    <Modal
      opened={open}
      onClose={() => setOpen(false)}
      title={t('invites.title')}
      closeButtonProps={{ className: styles.close }}
      centered
      size={460}
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t('invites.blurb')}
        </Text>

        {failed && <Alert color="red">{t('invites.failed')}</Alert>}

        {invites == null && !failed && <Loader size="sm" />}

        {invites?.map((invite) => (
          <InviteRow key={invite.id} invite={invite} onChanged={load} />
        ))}

        {invites?.length === 0 && (
          <Text size="sm" c="dimmed">
            {t('invites.none')}
          </Text>
        )}

        {mintFailed && <Alert color="red">{t(mintFailed)}</Alert>}

        {invites != null && (
          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed">
              {t('invites.left', { count: Math.max(left, 0) })}
            </Text>
            <Button
              size="xs"
              leftSection={<Icon icon="person_add" size={16} />}
              loading={minting}
              disabled={left <= 0}
              onClick={mint}
            >
              {t('invites.mint')}
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
};
