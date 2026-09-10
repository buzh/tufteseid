import { useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMapSettings } from '../../map/mapHooks';
import { isLikelyLonLatSwap } from '../../shared/utils/coordinateParser';
import { getInputCRS } from '../../shared/utils/crsUtils';
import { SearchResult } from '../../types/searchTypes';
import { Alert, Button } from '../../ui';
import { searchQueryAtom } from '../atoms';
import { SearchResultLine } from './SearchResultLine';
import styles from './SearchResults.module.css';

interface CoordinateResultsProps {
  coordinateResult: SearchResult | null;
  setSelectedResult: (result: SearchResult) => void;
  handleHover: (res: SearchResult) => void;
  setHoveredResult: (result: SearchResult | null) => void;
}

export const CoordinateResults = ({
  coordinateResult,
  setSelectedResult,
  handleHover,
  setHoveredResult,
}: CoordinateResultsProps) => {
  const { t } = useTranslation();
  const { setMapLocation } = useMapSettings();
  const setSearchQuery = useSetAtom(searchQueryAtom);

  const handleSearchClick = useCallback(
    (res: SearchResult) => {
      const { lon, lat } = res;
      setSelectedResult(res);
      setMapLocation([lon, lat], getInputCRS(res), 15);
    },
    [setSelectedResult, setMapLocation],
  );

  const handleSwapCoordinates = useCallback(() => {
    if (!coordinateResult || coordinateResult.type !== 'Coordinate') return;
    const coordResult = coordinateResult as Extract<
      SearchResult,
      { type: 'Coordinate' }
    >;
    const { lat, lon } = coordResult.coordinate;
    // What was parsed as lat is actually lon, and vice versa — swap them.
    const swappedLat = lon;
    const swappedLon = lat;
    const correctedQuery = `${swappedLat.toFixed(5)},${swappedLon.toFixed(5)}@EPSG:4326`;
    setSearchQuery(correctedQuery);
    const swappedResult: SearchResult = {
      ...coordResult,
      lat: swappedLat,
      lon: swappedLon,
      coordinate: {
        ...coordResult.coordinate,
        lat: swappedLat,
        lon: swappedLon,
        formattedString: `${swappedLat.toFixed(5)}, ${swappedLon.toFixed(5)} (WGS84)`,
      },
    };
    handleSearchClick(swappedResult);
  }, [coordinateResult, setSearchQuery, handleSearchClick]);

  if (!coordinateResult || coordinateResult.type !== 'Coordinate') {
    return null;
  }

  const showSwapWarning =
    coordinateResult.coordinate != null &&
    isLikelyLonLatSwap(coordinateResult.coordinate);

  return (
    <>
      <ul className={styles.list}>
        <SearchResultLine
          heading={coordinateResult.coordinate.formattedString}
          locationType={
            t('infoBox.coordinateSystem') +
            ': ' +
            coordinateResult.coordinate.projection
          }
          onClick={() => handleSearchClick(coordinateResult)}
          onMouseEnter={() => handleHover(coordinateResult)}
          onMouseLeave={() => setHoveredResult(null)}
        />
      </ul>
      {showSwapWarning && (
        <Alert tone="warning">
          <div className={styles.coordSwap}>
            {t('search.coordinateSwapWarning')}
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSwapCoordinates}
            >
              {t('search.coordinateSwapButton')}
            </Button>
          </div>
        </Alert>
      )}
    </>
  );
};
