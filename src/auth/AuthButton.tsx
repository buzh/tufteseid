// Whether there is an account behind this session, and the way in and out of
// one. One box at the far end of the band, next to the `+` it is the
// precondition for.
//
// Signed out it is a plain button that opens the dialog. Signed in it is lit,
// like every other on-state in the row, and opens a menu naming who you are —
// the name is the only thing the app knows about an account and the only thing
// worth saying, and it has to be somewhere, because a lit box alone does not
// say whose spots are being listed.

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
      {/* No Tooltip inside the target, following the other menus in the band:
          Mantine's target has to hold the ref, and a second wrapper that also
          wants it is one indirection for a label the dropdown already carries. */}
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
