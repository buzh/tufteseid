import {
  Alert,
  Anchor,
  Avatar,
  Button,
  Divider,
  FileButton,
  Group,
  Modal,
  PasswordInput,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { pb, type SiteUser } from '../api/pocketbase';
import { changeEmail, changePassword, saveProfile } from '../api/profile';
import { Icon } from '../ui/Icon';
import {
  currentUserAtom,
  isAuthDialogOpenAtom,
  isProfileDialogOpenAtom,
} from './atoms';
import styles from './ProfileDialog.module.css';
import { badFields } from './session';

const ABOUT_MAX = 120;

const PICTURES = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

const emailFailure = (err: unknown): string => {
  const fields = badFields(err);
  if (fields.includes('password')) return 'profile.email.wrongPassword';
  if (fields.includes('email')) return 'profile.email.unavailable';
  return 'profile.email.failed';
};

const passwordFailure = (err: unknown): string => {
  const fields = badFields(err);
  if (fields.includes('oldPassword')) return 'profile.password.wrongOld';
  if (fields.includes('password')) return 'profile.password.tooShort';
  return 'profile.password.failed';
};

const ProfileForm = ({ user }: { user: SiteUser }) => {
  const { t } = useTranslation();
  const [name, setName] = useState(user.name);
  const [about, setAbout] = useState(user.description ?? '');
  const [picture, setPicture] = useState<File | null | undefined>(undefined);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(
    () => (preview ? () => URL.revokeObjectURL(preview) : undefined),
    [preview],
  );

  const stored =
    picture === undefined && user.avatar
      ? pb.files.getURL(user, user.avatar, { thumb: '160x160' })
      : null;

  const pick = (file: File | null) => {
    setPreview(file ? URL.createObjectURL(file) : null);
    setPicture(file ?? undefined);
    setSaved(false);
  };

  const save = () => {
    setBusy(true);
    setFailed(false);
    setSaved(false);
    saveProfile(user.id, {
      name: name.trim(),
      description: about.trim(),
      avatar: picture,
    })
      .then(() => {
        setPreview(null);
        setPicture(undefined);
        setSaved(true);
      })
      .catch((err: unknown) => {
        console.warn('[profile] saving failed', err);
        setFailed(true);
      })
      .finally(() => setBusy(false));
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) save();
      }}
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t('profile.blurb')}
        </Text>

        <Group gap="sm" wrap="nowrap" align="flex-start">
          <Avatar size={64} radius="sm" src={preview ?? stored} />
          <Stack gap={6}>
            <Group gap="xs">
              <FileButton accept={PICTURES} onChange={pick}>
                {(props) => (
                  <Button
                    {...props}
                    size="xs"
                    variant="default"
                    leftSection={<Icon icon="image" size={16} />}
                  >
                    {t('profile.pick')}
                  </Button>
                )}
              </FileButton>
              {(preview ?? stored) && (
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  onClick={() => {
                    setPreview(null);
                    setPicture(null);
                    setSaved(false);
                  }}
                >
                  {t('profile.drop')}
                </Button>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {t('profile.avatarHelp')}
            </Text>
          </Stack>
        </Group>

        <TextInput
          label={t('profile.name')}
          description={t('profile.nameHelp')}
          autoComplete="nickname"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          disabled={busy}
        />

        <Textarea
          label={t('profile.about')}
          description={t('profile.aboutHelp', {
            used: about.length,
            max: ABOUT_MAX,
          })}
          maxLength={ABOUT_MAX}
          autosize
          minRows={2}
          value={about}
          onChange={(event) => setAbout(event.currentTarget.value)}
          disabled={busy}
        />

        {failed && <Alert color="red">{t('profile.failed')}</Alert>}
        {saved && <Alert color="green">{t('profile.saved')}</Alert>}

        <Group justify="flex-end">
          <Button type="submit" loading={busy}>
            {t('profile.save')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
};

const EmailForm = ({ user }: { user: SiteUser }) => {
  const { t } = useTranslation();
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  const enough =
    email.trim() !== '' && email.trim() !== user.email && password !== '';

  const submit = () => {
    setBusy(true);
    setFailed(null);
    setChanged(false);
    changeEmail(email.trim(), password)
      .then(() => {
        setPassword('');
        setChanged(true);
      })
      .catch((err: unknown) => {
        console.warn('[profile] changing the address failed', err);
        setFailed(emailFailure(err));
      })
      .finally(() => setBusy(false));
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (enough && !busy) submit();
      }}
    >
      <Stack gap="sm">
        <Text fw={600} size="sm">
          {t('profile.email.title')}
        </Text>
        <Text size="sm" c="dimmed">
          {t('profile.email.blurb')}
        </Text>

        <TextInput
          label={t('profile.email.address')}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          disabled={busy}
        />

        <PasswordInput
          label={t('profile.email.password')}
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          disabled={busy}
        />

        {failed && <Alert color="red">{t(failed)}</Alert>}
        {changed && <Alert color="green">{t('profile.email.changed')}</Alert>}

        <Group justify="flex-end">
          <Button type="submit" loading={busy} disabled={!enough}>
            {t('profile.email.submit')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
};

const PasswordForm = ({
  user,
  onSessionLost,
}: {
  user: SiteUser;
  onSessionLost: () => void;
}) => {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  const enough = current !== '' && next !== '' && again !== '';

  const submit = () => {
    if (next !== again) {
      setFailed('profile.password.mismatch');
      return;
    }
    setBusy(true);
    setFailed(null);
    setChanged(false);
    changePassword({
      id: user.id,
      email: user.email,
      oldPassword: current,
      password: next,
    })
      .then((signedIn) => {
        if (!signedIn) {
          onSessionLost();
          return;
        }
        setCurrent('');
        setNext('');
        setAgain('');
        setChanged(true);
      })
      .catch((err: unknown) => {
        console.warn('[profile] changing the password failed', err);
        setFailed(passwordFailure(err));
      })
      .finally(() => setBusy(false));
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (enough && !busy) submit();
      }}
    >
      <Stack gap="sm">
        <PasswordInput
          label={t('profile.password.old')}
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.currentTarget.value)}
          disabled={busy}
        />
        <PasswordInput
          label={t('profile.password.new')}
          description={t('auth.passwordHelp')}
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.currentTarget.value)}
          disabled={busy}
        />
        <PasswordInput
          label={t('profile.password.confirm')}
          autoComplete="new-password"
          value={again}
          onChange={(event) => setAgain(event.currentTarget.value)}
          disabled={busy}
        />

        {failed && <Alert color="red">{t(failed)}</Alert>}
        {changed && (
          <Alert color="green">{t('profile.password.changed')}</Alert>
        )}

        <Group justify="flex-end">
          <Button type="submit" loading={busy} disabled={!enough}>
            {t('profile.password.submit')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
};

export const ProfileDialog = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useAtom(isProfileDialogOpenAtom);
  const user = useAtomValue(currentUserAtom);
  const openSignIn = useSetAtom(isAuthDialogOpenAtom);
  const [changingPassword, setChangingPassword] = useState(false);

  if (!user) return null;

  const close = () => {
    setChangingPassword(false);
    setOpen(false);
  };

  const sessionLost = () => {
    close();
    openSignIn(true);
  };

  return (
    <Modal
      opened={open}
      onClose={close}
      title={t('profile.title')}
      closeButtonProps={{ className: styles.close }}
      centered
      size={460}
    >
      <Stack gap="md">
        <ProfileForm user={user} />

        <Divider />
        <EmailForm user={user} />

        <Divider />
        {changingPassword ? (
          <PasswordForm user={user} onSessionLost={sessionLost} />
        ) : (
          <Anchor
            component="button"
            type="button"
            size="sm"
            onClick={() => setChangingPassword(true)}
          >
            {t('profile.password.open')}
          </Anchor>
        )}
      </Stack>
    </Modal>
  );
};
