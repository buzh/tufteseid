import { useTranslation } from 'react-i18next';
import styles from './LanguageSwitcher.module.css';

const LANGUAGES = [
  { value: 'nb', label: 'Norsk (bokmål)' },
  { value: 'nn', label: 'Norsk (nynorsk)' },
  { value: 'en', label: 'English' },
];

// A native <select>: three options, chosen once, not worth a custom listbox.
export const LanguageSwitcher = () => {
  const { i18n, t } = useTranslation();

  // i18next hands back region-tagged codes ('nb-NO'); the options are
  // language-only.
  const current = (i18n.language || 'nb').split('-')[0];

  return (
    <select
      className={styles.select}
      aria-label={t('languageSelector.chooseLanguage')}
      value={LANGUAGES.some((l) => l.value === current) ? current : 'nb'}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
    >
      {LANGUAGES.map((lang) => (
        <option key={lang.value} value={lang.value}>
          {lang.label}
        </option>
      ))}
    </select>
  );
};

export default LanguageSwitcher;
