import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui';
import { displaySearchResultsAtom } from '../atoms';
import styles from './SearchResults.module.css';

export const SearchResultLine = ({
  heading,
  locationType = null,
  onClick,
  showButton = false,
  onButtonClick,
  onMouseEnter,
  onMouseLeave,
}: {
  heading: string;
  locationType?: string | null;
  onClick: () => void;
  showButton?: boolean;
  onButtonClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) => {
  const { t } = useTranslation();
  const setDisplaySearchResults = useSetAtom(displaySearchResultsAtom);

  return (
    <li
      className={styles.line}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        type="button"
        className={styles.lineMain}
        onClick={() => {
          setDisplaySearchResults(false);
          onClick();
        }}
      >
        <span className={styles.lineHeading}>{heading}</span>
        {locationType && (
          <span className={styles.lineType} title={locationType}>
            {locationType}
          </span>
        )}
      </button>
      {showButton && (
        <Button
          size="sm"
          variant="secondary"
          palette="gray"
          onClick={() => onButtonClick?.()}
        >
          {t('search.houseNumber')}
        </Button>
      )}
    </li>
  );
};
