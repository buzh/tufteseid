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
import { useCapacity } from '../auth/hooks';
import { Icon } from '../ui/Icon';
import { isInvitesDialogOpenAtom } from './atoms';
import { inviteUrlOf } from './inviteLink';
import styles from './InvitesDialog.module.css';

const ANSWER_MS = 2000;

const validationCode = (err: unknown, field: 'email' | 'issuer'): string =>
  (err as { response?: { data?: Record<string, { code?: string }> } })?.response
    ?.data?.[field]?.code ?? '';

const sendFailure = (err: unknown): string =>
  validationCode(err, 'email') === 'mail_failed'
    ? 'invites.mailFailed'
    : 'invites.sendFailed';

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

  const sent = invite.sentAt !== '';

  const copy = () => {
    void navigator.clipboard
      .writeText(inviteUrlOf(invite.code))
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

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
      </Group>

      {sent ? (
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
  const capacity = useCapacity(open);
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

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const minted = invites?.length ?? 0;
  const left = (user?.inviteQuota ?? 0) - minted;
  const outstanding = invites?.filter((invite) => invite.redeemedAt === '');

  const cap = capacity && capacity.max > 0 ? capacity : null;

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

        {cap && (
          <Text size="xs" c="dimmed">
            {t('shared.userCap', { count: cap.users, max: cap.max })}
          </Text>
        )}

        {cap && cap.users >= cap.max && (
          <Alert color="yellow">{t('invites.capFull')}</Alert>
        )}

        {failed && <Alert color="red">{t('invites.failed')}</Alert>}

        {invites == null && !failed && <Loader size="sm" />}

        {outstanding?.map((invite) => (
          <InviteRow key={invite.id} invite={invite} onChanged={load} />
        ))}

        {outstanding?.length === 0 && (
          <Text size="sm" c="dimmed">
            {t('invites.none')}
          </Text>
        )}

        {mintFailed && <Alert color="red">{t(mintFailed)}</Alert>}

        {invites != null && (
          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed">
              {t('invites.available', { count: Math.max(left, 0) })}
              {' / '}
              {t('invites.sent', { count: minted })}
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
