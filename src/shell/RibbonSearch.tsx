import { useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  displaySearchResultsAtom,
  searchQueryAtom,
  useResetSearchResults,
} from '../search/atoms';
import { Icon, IconButton, Input } from '../ui';
import styles from './RibbonSearch.module.css';

/** The query field only; results render in the left slot (SearchComponent). */
export const RibbonSearch = () => {
  const { t } = useTranslation();
  const [query, setQuery] = useAtom(searchQueryAtom);
  const setDisplayResults = useSetAtom(displaySearchResultsAtom);
  const resetResults = useResetSearchResults();

  return (
    <div className={styles.root}>
      <Icon icon="search" size={18} className={styles.icon} />
      <Input
        // Not type="search": WebKit adds its own clear affordance.
        type="text"
        size="md"
        className={styles.input}
        placeholder={t('search.placeholder')}
        aria-label={t('search.placeholder')}
        value={query}
        maxLength={100}
        onChange={(e) => setQuery(e.target.value)}
        onClick={() => setDisplayResults(true)}
      />
      {query !== '' && (
        <IconButton
          icon="close"
          size="xs"
          palette="gray"
          aria-label={t('ribbon.search.clear')}
          className={styles.clear}
          onClick={resetResults}
        />
      )}
    </div>
  );
};
