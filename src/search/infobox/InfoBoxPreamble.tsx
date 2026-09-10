import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getInputCRS } from '../../shared/utils/crsUtils';
import { isNumberOk } from '../../shared/utils/numberUtils';
import { SearchResult } from '../../types/searchTypes';
import { Icon, Tooltip } from '../../ui';
import { getElevation } from '../searchApi';
import styles from './InfoBox.module.css';

interface InfoBoxContentProps {
  result: SearchResult;
}

const InfoBoxTextContent = ({ result }: { result: SearchResult }) => {
  const { t } = useTranslation();
  switch (result.type) {
    case 'Place':
      return (
        <p>
          {`${t('search.placeName')} ${result.place.municipalities != null && `${t('infoBox.in')} ${result.place.municipalities.map((k) => k.kommunenavn).join(', ')} ${t('infoBox.municipality').toLowerCase()}`}`}
        </p>
      );

    case 'Road':
      return (
        <p>
          {`${t('infoBox.roadName')} ${t('infoBox.in')} ${result.road.KOMMUNENAVN} ${t('infoBox.municipality').toLowerCase()}`}
        </p>
      );

    case 'Property':
      return (
        <p>
          {`${t('infoBox.cadastralIdentifier')} ${t('infoBox.in')} ${result.property.KOMMUNENAVN} ${t('infoBox.municipality').toLowerCase()}`}
        </p>
      );

    case 'Address':
      return (
        <p>
          {`${t('infoBox.address')} ${t('infoBox.in')} ${result.address.kommunenavn} ${t('infoBox.municipality').toLowerCase()}`}
        </p>
      );
  }
};

const InfoBoxElevationContent = ({ result }: { result: SearchResult }) => {
  const { t } = useTranslation();
  const inputCRS = getInputCRS(result);

  const { data: elevationData, status } = useQuery<{ value: string }>({
    queryKey: ['elevation', result.lon, result.lat],
    queryFn: () => getElevation(result.lon, result.lat, inputCRS),
    enabled: isNumberOk(result.lat) && isNumberOk(result.lon),
  });
  if (status !== 'success') {
    return null;
  }
  const numericValue = Number(elevationData.value);
  if (isNaN(numericValue)) {
    return null;
  }

  return (
    <div className={styles.elevation}>
      <p>
        {t('infoBox.heightEstimatedByInterpolation')}{' '}
        {numericValue.toFixed(1)} {t('infoBox.metersAboveSeaLevel')}
      </p>
      {/* The caveat about how that number was arrived at is a hover label,
          not the click-to-open popover it used to be — it is one sentence,
          and nothing in it is worth a second click. */}
      <Tooltip
        label={t('infoBox.metersAboveSeaLevelTooltip')}
        placement="top"
      >
        <Icon icon="info" size={16} />
      </Tooltip>
    </div>
  );
};

export const InfoBoxPreamble = ({ result }: InfoBoxContentProps) => (
  <div className={styles.preamble}>
    <InfoBoxTextContent result={result} />
    <InfoBoxElevationContent result={result} />
  </div>
);
