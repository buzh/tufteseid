import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMapSettings } from '../../map/mapHooks.ts';
import { getInputCRS } from '../../shared/utils/crsUtils.ts';
import { SearchResult } from '../../types/searchTypes.ts';
import { cx } from '../../ui';
import {
  allSearchResultsAtom,
  coordinateResultsAtom,
  displaySearchResultsAtom,
  searchQueryAtom,
  selectedResultAtom,
} from '../atoms.ts';
import { updateSearchMarkers } from '../searchmarkers/updateSearchMarkers.ts';
import { AddressesResults } from './AddressesResults.tsx';
import { CoordinateResults } from './CoorResult.tsx';
import { PlacesResult } from './PlacesResults.tsx';
import { PropertiesResults } from './PropertiesResults.tsx';
import { RoadsResults } from './RoadsResults.tsx';
import styles from './SearchResults.module.css';

type ResultTab = 'places' | 'roads' | 'properties' | 'addresses';

interface SearchResultsProps {
  hoveredResult: SearchResult | null;
  setHoveredResult: (result: SearchResult | null) => void;
}

export const SearchResults = ({
  hoveredResult,
  setHoveredResult,
}: SearchResultsProps) => {
  const { setMapLocation } = useMapSettings();
  const searchQuery = useAtomValue(searchQueryAtom);
  const { t } = useTranslation();
  const displaySearchResults = useAtomValue(displaySearchResultsAtom);

  // The sections are independent disclosures, all open to begin with, so the
  // container holds the set and each section is a controlled `Section`.
  const [openTabs, setOpenTabs] = useState<ResultTab[]>([
    'places',
    'roads',
    'properties',
    'addresses',
  ]);
  const tabProps = (tab: ResultTab) => ({
    open: openTabs.includes(tab),
    onOpenChange: (open: boolean) =>
      setOpenTabs((prev) =>
        open ? [...prev, tab] : prev.filter((it) => it !== tab),
      ),
  });

  const coord = useAtomValue(coordinateResultsAtom);
  const coordResult: SearchResult | null = useMemo(() => {
    return coord
      ? {
          type: 'Coordinate',
          name: `Coordinate: ${coord.formattedString}`,
          lat: coord.lat,
          lon: coord.lon,
          coordinate: coord,
        }
      : null;
  }, [coord]);

  const allResults = useAtomValue(allSearchResultsAtom);

  const [selectedResult, setSelectedResult] = useAtom(selectedResultAtom);

  const handleHover = (res: SearchResult) => {
    setHoveredResult(res);
  };

  const handleSearchClick = useCallback(
    (res: SearchResult) => {
      const { lon, lat } = res;
      setSelectedResult(res);
      setMapLocation([lon, lat], getInputCRS(res), 15);
    },
    [setSelectedResult, setMapLocation],
  );

  useEffect(() => {
    updateSearchMarkers(
      [...(coordResult ? [coordResult] : []), ...allResults],
      hoveredResult,
      selectedResult,
      handleSearchClick,
    );
  }, [
    allResults,
    coordResult,
    hoveredResult,
    selectedResult,
    handleSearchClick,
  ]);

  if (allResults.length === 0 && coordResult == null) {
    if (searchQuery !== '') {
      return <div className={styles.panel}>{t('search.noResults')}</div>;
    }
    return null;
  }

  return (
    <div className={cx(styles.panel, !displaySearchResults && styles.hidden)}>
      {coordResult != null ? (
        <CoordinateResults
          coordinateResult={coordResult}
          setSelectedResult={handleSearchClick}
          handleHover={handleHover}
          setHoveredResult={setHoveredResult}
        />
      ) : (
        <>
          <AddressesResults
            handleSearchClick={handleSearchClick}
            handleHover={handleHover}
            setHoveredResult={setHoveredResult}
            {...tabProps('addresses')}
          />
          <PlacesResult
            handleSearchClick={handleSearchClick}
            handleHover={handleHover}
            setHoveredResult={setHoveredResult}
            {...tabProps('places')}
          />
          <RoadsResults
            handleSearchClick={handleSearchClick}
            handleHover={handleHover}
            setHoveredResult={setHoveredResult}
            {...tabProps('roads')}
          />
          <PropertiesResults
            handleSearchClick={handleSearchClick}
            handleHover={handleHover}
            setHoveredResult={setHoveredResult}
            {...tabProps('properties')}
          />
        </>
      )}
    </div>
  );
};
