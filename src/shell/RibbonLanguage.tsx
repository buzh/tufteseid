import { useTranslation } from 'react-i18next';
import { IconButton, Menu, Tooltip } from '../ui';

const LANGUAGES = [
  { value: 'nb', label: 'Norsk (bokmål)' },
  { value: 'nn', label: 'Norsk (nynorsk)' },
  { value: 'en', label: 'English' },
];

/**
 * The only language control in the app, which is why it sits outside the
 * signed-in group: a guest following a shared link has to be able to reach it
 * too. Chosen once and remembered — `i18n.changeLanguage` writes localStorage,
 * which the detector reads ahead of the browser's own preference.
 */
export const RibbonLanguage = () => {
  const { i18n, t } = useTranslation();
  const label = t('languageSelector.chooseLanguage');
  // i18next hands back region-tagged codes ('nb-NO'); the options are
  // language-only.
  const current = (i18n.language || 'nb').split('-')[0];

  return (
    <Menu
      align="end"
      width={190}
      label={label}
      title={label}
      items={LANGUAGES.map((lang) => ({
        label: lang.label,
        active: lang.value === current,
        onSelect: () => i18n.changeLanguage(lang.value),
      }))}
      trigger={({ open, onClick }) => (
        <Tooltip label={label}>
          <IconButton
            icon="language"
            size="md"
            variant={open ? 'primary' : 'ghost'}
            aria-label={label}
            aria-expanded={open}
            onClick={() => onClick()}
          />
        </Tooltip>
      )}
    />
  );
};
