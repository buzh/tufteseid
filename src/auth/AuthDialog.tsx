import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '../ui';
import { isAuthDialogOpenAtom } from './atoms-dialog';
import styles from './AuthDialog.module.css';
import { useOAuthProviders, useSignIn } from './hooks';

// PB provider name → localised display label. Falls back to the raw
// provider name if we haven't localised it yet — safe because PB's
// name field is stable ("google", "github", "microsoft", …).
const providerLabel = (name: string): string => {
  const map: Record<string, string> = {
    google: 'Google',
    github: 'GitHub',
    microsoft: 'Microsoft',
    gitlab: 'GitLab',
    apple: 'Apple',
    oidc: 'OIDC',
  };
  return map[name] ?? name;
};

export const AuthDialog = () => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useAtom(isAuthDialogOpenAtom);
  const { providers, error } = useOAuthProviders();
  const signIn = useSignIn();

  const handle = async (providerName: string) => {
    try {
      await signIn(providerName);
      setIsOpen(false);
    } catch (e) {
      // Popup blocked, user cancelled, or provider misconfigured. The
      // PB error message is usually informative enough — surface it
      // rather than swallowing.
      console.warn('[auth] sign-in failed', e);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={setIsOpen}
      title={t('auth.dialog.title')}
      closeLabel={t('shared.close')}
    >
      <div className={styles.body}>
        <p className={styles.subtitle}>{t('auth.dialog.subtitle')}</p>
        {error && (
          <p className={styles.error}>{t('auth.dialog.providersError')}</p>
        )}
        {providers == null && !error && (
          <p className={styles.status}>{t('auth.dialog.loading')}</p>
        )}
        {providers && providers.length === 0 && (
          <p className={styles.subtitle}>{t('auth.dialog.noProviders')}</p>
        )}
        {providers?.map((p) => (
          <Button
            key={p.name}
            variant="secondary"
            size="md"
            onClick={() => handle(p.name)}
          >
            {t('auth.dialog.signInWith', { provider: providerLabel(p.name) })}
          </Button>
        ))}
      </div>
    </Dialog>
  );
};
