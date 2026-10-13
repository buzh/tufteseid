import {
  Avatar,
  Box,
  Group,
  Menu,
  SegmentedControl,
  Text,
} from '@mantine/core';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { pb } from '../api/pocketbase';
import { getEnv } from '../env';
import { isInvitesDialogOpenAtom } from '../invites/atoms';
import { ControlButton } from '../ui/ControlButton';
import { Icon } from '../ui/Icon';
import { uiScaleAtom, type UiScale } from '../ui/uiScale';
import {
  currentUserAtom,
  isAdminAtom,
  isAuthDialogOpenAtom,
  isProfileDialogOpenAtom,
} from './atoms';

const STATS_URL = '/stats/';
const POCKETBASE_ADMIN_URL = `${getEnv().pocketbaseUrl.replace(/\/$/, '')}/_/`;

const UiScaleSection = () => {
  const { t } = useTranslation();
  const [scale, setScale] = useAtom(uiScaleAtom);

  return (
    <>
      <Menu.Label>{t('uiScale.label')}</Menu.Label>
      <Box px="xs" pb={4}>
        <SegmentedControl
          fullWidth
          size="xs"
          value={scale}
          onChange={(value) => setScale(value as UiScale)}
          data={[
            { value: 'small', label: t('uiScale.small') },
            { value: 'large', label: t('uiScale.large') },
          ]}
        />
      </Box>
    </>
  );
};

export const AuthButton = () => {
  const { t } = useTranslation();
  const user = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const setDialogOpen = useSetAtom(isAuthDialogOpenAtom);
  const setInvitesOpen = useSetAtom(isInvitesDialogOpenAtom);
  const setProfileOpen = useSetAtom(isProfileDialogOpenAtom);

  if (!user) {
    return (
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ControlButton
            icon="account_circle"
            aria-label={t('auth.guestMenu')}
          />
        </Menu.Target>
        <Menu.Dropdown>
          <UiScaleSection />
          <Menu.Divider />
          <Menu.Item
            leftSection={<Icon icon="login" size={16} />}
            onClick={() => setDialogOpen(true)}
          >
            {t('auth.signIn')}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    );
  }

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ControlButton
          icon="account_circle"
          on
          title={user.name || user.email}
          aria-label={t('auth.account')}
        />
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>
          <Group gap="xs" wrap="nowrap">
            {}
            <Avatar
              size={20}
              radius="xl"
              src={
                user.avatar
                  ? pb.files.getURL(user, user.avatar, {
                      thumb: '40x40',
                    })
                  : null
              }
            />
            <Text size="xs" truncate>
              {user.name || user.email}
            </Text>
          </Group>
        </Menu.Label>
        <Menu.Divider />
        <UiScaleSection />
        <Menu.Divider />
        <Menu.Item
          leftSection={<Icon icon="settings" size={16} />}
          onClick={() => setProfileOpen(true)}
        >
          {t('profile.title')}
        </Menu.Item>
        <Menu.Item
          leftSection={<Icon icon="person_add" size={16} />}
          onClick={() => setInvitesOpen(true)}
        >
          {t('invites.title')}
        </Menu.Item>
        {isAdmin && (
          <>
            <Menu.Divider />
            <Menu.Item
              component="a"
              href={STATS_URL}
              target="_blank"
              rel="noreferrer"
              leftSection={<Icon icon="monitoring" size={16} />}
              rightSection={<Icon icon="open_in_new" size={14} />}
            >
              {t('auth.stats')}
            </Menu.Item>
            <Menu.Item
              component="a"
              href={POCKETBASE_ADMIN_URL}
              target="_blank"
              rel="noreferrer"
              leftSection={<Icon icon="database" size={16} />}
              rightSection={<Icon icon="open_in_new" size={14} />}
            >
              {t('auth.pocketbase')}
            </Menu.Item>
            <Menu.Divider />
          </>
        )}
        <Menu.Item
          leftSection={<Icon icon="logout" size={16} />}
          onClick={() => {

            setProfileOpen(false);
            pb.authStore.clear();
          }}
        >
          {t('auth.signOut')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
};
