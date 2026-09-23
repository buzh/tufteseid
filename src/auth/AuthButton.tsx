import { Menu, Text, Tooltip } from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { getEnv } from '../env';
import { ControlButton } from '../ui/ControlButton';
import { Icon } from '../ui/Icon';
import { currentUserAtom, isAdminAtom, isAuthDialogOpenAtom } from './atoms';
import { useSignOut } from './hooks';

// The GoAccess report Caddy serves out of the stats bind mount, and
// PocketBase's own dashboard behind the same proxy path as its API.
const STATS_URL = '/stats/';
const POCKETBASE_ADMIN_URL = `${getEnv().pocketbaseUrl.replace(/\/$/, '')}/_/`;

export const AuthButton = () => {
  const { t } = useTranslation();
  const user = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const setDialogOpen = useSetAtom(isAuthDialogOpenAtom);
  const signOut = useSignOut();

  if (!user) {
    return (
      <Tooltip label={t('auth.signIn')}>
        <ControlButton
          icon="account_circle"
          aria-label={t('auth.signIn')}
          onClick={() => setDialogOpen(true)}
        />
      </Tooltip>
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
          <Text size="xs" truncate>
            {user.name || user.email}
          </Text>
        </Menu.Label>
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
          onClick={signOut}
        >
          {t('auth.signOut')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
};
