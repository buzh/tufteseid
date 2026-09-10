import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { SearchResult } from '../../types/searchTypes';
import { Section } from '../../ui';
import { propertyResultsAtom } from '../atoms';
import { SearchResultLine } from './SearchResultLine';
import styles from './SearchResults.module.css';

interface PropertiesResultsProps {
  handleSearchClick: (res: SearchResult) => void;
  handleHover: (res: SearchResult) => void;
  setHoveredResult: (res: SearchResult | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const PropertiesResults = ({
  handleSearchClick,
  handleHover,
  setHoveredResult,
  open,
  onOpenChange,
}: PropertiesResultsProps) => {
  const { t } = useTranslation();
  const properties = useAtomValue(propertyResultsAtom);

  if (properties.length === 0) {
    return null;
  }

  return (
    <Section
      title={t('search.properties')}
      count={properties.length}
      open={open}
      onOpenChange={onOpenChange}
      className={styles.section}
    >
      <ul className={styles.list}>
        {properties.map((property, i) => (
          <SearchResultLine
            key={`property-${i}`}
            heading={property.TITTEL}
            onClick={() =>
              handleSearchClick({
                type: 'Property',
                name: property.TITTEL,
                lat: parseFloat(property.LATITUDE),
                lon: parseFloat(property.LONGITUDE),
                property,
              })
            }
            onMouseEnter={() =>
              handleHover({
                type: 'Property',
                name: property.TITTEL,
                lat: parseFloat(property.LATITUDE),
                lon: parseFloat(property.LONGITUDE),
                property,
              })
            }
            onMouseLeave={() => setHoveredResult(null)}
            locationType={property.KOMMUNENAVN}
          />
        ))}
      </ul>
    </Section>
  );
};
