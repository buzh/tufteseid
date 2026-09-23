import { Menu, Text, Tooltip } from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { ControlButton } from '../ui/ControlButton';
import { Icon } from '../ui/Icon';
import { currentUserAtom, isAuthDialogOpenAtom } from './atoms';
import { useSignOut } from './hooks';

export const AuthButton = () => {
  const { t } = useTranslation();
  const user = useAtomValue(currentUserAtom);
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
