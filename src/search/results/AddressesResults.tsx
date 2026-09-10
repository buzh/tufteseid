import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  capitalizeFirstLetter,
  computeLevenshteinDistance,
} from '../../shared/utils/stringUtils';
import { SearchResult } from '../../types/searchTypes';
import { Section } from '../../ui';
import { addressResultsAtom, searchQueryAtom } from '../atoms';
import { SearchResultLine } from './SearchResultLine';
import styles from './SearchResults.module.css';

interface AddressesResultsProps {
  handleSearchClick: (res: SearchResult) => void;
  handleHover: (res: SearchResult) => void;
  setHoveredResult: (res: SearchResult | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const AddressesResults = ({
  handleSearchClick,
  handleHover,
  setHoveredResult,
  open,
  onOpenChange,
}: AddressesResultsProps) => {
  const { t } = useTranslation();
  const addresses = useAtomValue(addressResultsAtom);
  const searchQuery = useAtomValue(searchQueryAtom);

  if (addresses.length === 0) {
    return null;
  }

  addresses.sort((a, b) => {
    const distA = computeLevenshteinDistance(
      searchQuery.toLocaleLowerCase(),
      a.adressetekst,
    );
    const distB = computeLevenshteinDistance(
      searchQuery.toLocaleLowerCase(),
      b.adressetekst,
    );
    return distA - distB;
  });

  return (
    <Section
      title={t('search.addresses')}
      count={addresses.length}
      open={open}
      onOpenChange={onOpenChange}
      className={styles.section}
    >
      <ul className={styles.list}>
        {addresses.map((address, i) => (
          <SearchResultLine
            key={`address-${i}`}
            heading={`${address.adressetekst}, ${address.postnummer} ${capitalizeFirstLetter(address.poststed.toLocaleLowerCase())}`}
            onClick={() =>
              handleSearchClick({
                type: 'Address',
                name: address.adressenavn,
                lat: address.representasjonspunkt.lat,
                lon: address.representasjonspunkt.lon,
                address,
              })
            }
            onMouseEnter={() =>
              handleHover({
                type: 'Address',
                name: address.adressenavn,
                lat: address.representasjonspunkt.lat,
                lon: address.representasjonspunkt.lon,
                address,
              })
            }
            onMouseLeave={() => setHoveredResult(null)}
          />
        ))}
      </ul>
    </Section>
  );
};
