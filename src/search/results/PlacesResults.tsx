import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { SearchResult } from '../../types/searchTypes';
import { IconButton, Section } from '../../ui';
import {
  placeNameMetedataAtom,
  placeNamePageAtom,
  placeNameResultsAtom,
} from '../atoms';
import { SearchResultLine } from './SearchResultLine';
import styles from './SearchResults.module.css';

interface PlacesResultProps {
  handleSearchClick: (res: SearchResult) => void;
  handleHover: (res: SearchResult) => void;
  setHoveredResult: (res: SearchResult | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const PlacesResult = ({
  handleSearchClick,
  handleHover,
  setHoveredResult,
  open,
  onOpenChange,
}: PlacesResultProps) => {
  const places = useAtomValue(placeNameResultsAtom);
  const placesMetadata = useAtomValue(placeNameMetedataAtom);
  const [placesPage, setPlacesPage] = useAtom(placeNamePageAtom);

  const { t } = useTranslation();
  if (placesMetadata === null) {
    return null;
  }
  if (places.length === 0) {
    return null;
  }

  // Place names are the only result set the API pages; everything else
  // arrives whole. Prev/next over numbered pages, because the count runs to
  // hundreds and the panel is 450 px wide.
  const pageCount = Math.ceil(
    placesMetadata.totaltAntallTreff / placesMetadata.treffPerSide,
  );

  return (
    <Section
      title={t('search.placeName')}
      count={placesMetadata.totaltAntallTreff}
      open={open}
      onOpenChange={onOpenChange}
      className={styles.section}
    >
      <ul className={styles.list}>
        {places.map((place, i) => {
          const municipalityNames =
            place.municipalities && place.municipalities.length > 0
              ? place.municipalities.map((k) => k.kommunenavn).join(', ')
              : '';
          return (
            <SearchResultLine
              key={`place-${i}`}
              heading={place.name}
              onClick={() => {
                handleSearchClick({
                  type: 'Place',
                  name: place.name,
                  lat: place.location.nord,
                  lon: place.location.øst,
                  place,
                });
              }}
              onMouseEnter={() =>
                handleHover({
                  type: 'Place',
                  name: place.name,
                  lat: place.location.nord,
                  lon: place.location.øst,
                  place,
                })
              }
              onMouseLeave={() => setHoveredResult(null)}
              locationType={
                municipalityNames
                  ? `${place.placeType} i ${municipalityNames}`
                  : place.placeType
              }
            />
          );
        })}
      </ul>
      {pageCount > 1 && (
        <div className={styles.pagination}>
          <IconButton
            icon="chevron_left"
            size="xs"
            palette="gray"
            aria-label={t('search.pagination.previous')}
            disabled={placesPage <= 1}
            onClick={() => setPlacesPage(placesPage - 1)}
          />
          <span className={styles.pageStatus}>
            {t('search.pagination.status', {
              page: placesPage,
              pages: pageCount,
            })}
          </span>
          <IconButton
            icon="chevron_right"
            size="xs"
            palette="gray"
            aria-label={t('search.pagination.next')}
            disabled={placesPage >= pageCount}
            onClick={() => setPlacesPage(placesPage + 1)}
          />
        </div>
      )}
    </Section>
  );
};
