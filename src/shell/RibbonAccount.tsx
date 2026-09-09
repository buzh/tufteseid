import { useAtomValue, useSetAtom } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getUserAvatarUrl } from '../api/pocketbase';
import { currentUserAtom, isAdminAtom } from '../auth/atoms';
import { isAuthDialogOpenAtom } from '../auth/atoms-dialog';
import { useSignOut } from '../auth/hooks';
import { Button, Popover } from '../ui';
import styles from './RibbonAccount.module.css';

const initials = (nameOrEmail: string): string => {
  const trimmed = nameOrEmail.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/[\s@._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? trimmed[0];
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
};

export const RibbonAccount = () => {
  const { t } = useTranslation();
  const user = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const openDialog = useSetAtom(isAuthDialogOpenAtom);
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);

  if (!user) {
    return (
      <Button
        variant="secondary"
        size="md"
        leftIcon="login"
        onClick={() => openDialog(true)}
      >
        {t('auth.signIn')}
      </Button>
    );
  }

  const label = user.name || user.email;
  const avatarUrl = getUserAvatarUrl(user);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      minWidth={200}
      padded={false}
      label={label}
      trigger={
        <Button
          size="md"
          className={styles.trigger}
          aria-label={label}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className={styles.avatar}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className={styles.avatarImage} />
            ) : (
              initials(label)
            )}
          </span>
        </Button>
      }
    >
      <p className={styles.name}>{label}</p>
      {isAdmin && <p className={styles.role}>{t('auth.roleAdmin')}</p>}
      <div className={styles.rule} />
      <Button
        fullWidth
        className={styles.signOut}
        leftIcon="logout"
        onClick={() => {
          signOut();
          setOpen(false);
        }}
      >
        {t('auth.signOut')}
      </Button>
    </Popover>
  );
};
