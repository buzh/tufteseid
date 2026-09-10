import { useQuery } from '@tanstack/react-query';
import { getDefaultStore } from 'jotai';
import VectorLayer from 'ol/layer/Vector';
import { transform } from 'ol/proj';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPropertyGeometry } from '../../api/nkApiClient';
import { getPropertyGeometryLayer } from '../../draw/drawControls/hooks/mapLayers';
import { mapAtom } from '../../map/atoms';
import { mapLayers } from '../../map/layers';
import { capitalizeFirstLetter } from '../../shared/utils/stringUtils';
import {
  getUrlParameter,
  removeUrlParameter,
  setUrlParameter,
} from '../../shared/utils/urlUtils';
import { Property } from '../../types/searchTypes';
import { cx, Section, Switch } from '../../ui';
import {
  getPropertyDetailsByMatrikkelId,
  getPropetyInfoByCoordinates,
} from '../searchApi';
import styles from './InfoBox.module.css';
import { getContainingExtent } from './utils';

export interface PropertyInfoProps {
  lon: number;
  lat: number;
  inputCRS: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}

const fetchPropertyDetailsByCoordinates = async (
  lat4326: number,
  lon4326: number,
): Promise<Property | Property[]> => {
  const info = await getPropetyInfoByCoordinates(lat4326, lon4326);
  const property = info?.features?.[0]?.properties;
  if (!property) throw new Error('Ingen matrikkelreferanse funnet');
  const municipalityNumber = property.kommunenummer;
  const holdingNumber = property.gardsnummer;
  const subholdingNumber = property.bruksnummer;
  const leaseNumber = property.festenummer || '0';
  const sectionNumber = property.seksjonsnummer || '0';
  return getPropertyDetailsByMatrikkelId(
    municipalityNumber,
    holdingNumber,
    subholdingNumber,
    leaseNumber,
    sectionNumber,
  );
};

export const PropertyInfo = ({
  lon,
  lat,
  inputCRS,
  open,
  onOpenChange,
  className,
}: PropertyInfoProps) => {
  const { t } = useTranslation();
  const [lon4326, lat4326] = transform([lon, lat], inputCRS, 'EPSG:4326');

  const [showGeometry, setShowGeometry] = useState(() => {
    const showSelectionParam = getUrlParameter('showSelection');
    return showSelectionParam === 'true';
  });

  const {
    data: propertyDetails,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['propertyDetails', lat4326, lon4326],
    queryFn: () => fetchPropertyDetailsByCoordinates(lat4326, lon4326),
    enabled: lat4326 != null && lon4326 != null,
  });

  const property: Property | undefined = Array.isArray(propertyDetails)
    ? propertyDetails?.[0]
    : propertyDetails;

  useEffect(() => {
    const handleShowGeometry = async (checked: boolean, prop: Property) => {
      const existingLayer = getPropertyGeometryLayer();
      const map = getDefaultStore().get(mapAtom);
      if (existingLayer) {
        map.removeLayer(existingLayer);
      }
      if (checked) {
        const layerToAdd =
          mapLayers.propertyGeometryLayer.getLayer() as VectorLayer;
        const features = await getPropertyGeometry(
          prop.KOMMUNENR,
          prop.GARDSNR,
          prop.BRUKSNR,
          prop.FESTENR,
          prop.SEKSJONSNR,
        );

        if (features) {
          layerToAdd.getSource()?.addFeatures(features);
          map.addLayer(layerToAdd);
          const containingExtent = getContainingExtent(features);

          if (containingExtent) {
            // Expand extent by 20%
            const [minX, minY, maxX, maxY] = containingExtent;
            const width = maxX - minX;
            const height = maxY - minY;
            const expandX = width * 0.1;
            const expandY = height * 0.1;
            const expandedExtent = [
              minX - expandX,
              minY - expandY,
              maxX + expandX,
              maxY + expandY,
            ];
            map.getView().fit(expandedExtent, { duration: 100 });
          }
        }
      }
    };
    if (property) {
      handleShowGeometry(showGeometry, property);
    }
    if (showGeometry) {
      setUrlParameter('showSelection', 'true');
    } else {
      removeUrlParameter('showSelection');
    }
    return () => {
      const existingLayer = getPropertyGeometryLayer();
      const map = getDefaultStore().get(mapAtom);
      if (existingLayer) {
        map.removeLayer(existingLayer);
      }
    };
  }, [showGeometry, property]);

  if (isLoading || error || propertyDetails == null) return null;

  if (!property) {
    return <>Ingen eiendomsinformasjon funnet.</>;
  }

  const hasMultipleAddresses =
    Array.isArray(propertyDetails) && propertyDetails.length > 1;

  const addresses = property.VEGADRESSE?.filter(Boolean) ?? [];

  const rows = [
    [t('propertyInfo.municipalityNr'), property.KOMMUNENR],
    [t('infoBox.municipality'), capitalizeFirstLetter(property.KOMMUNENAVN)],
    [t('propertyInfo.holdingNr'), property.GARDSNR],
    [t('propertyInfo.subholdingNr'), property.BRUKSNR],
    [t('propertyInfo.leaseNr'), property.FESTENR],
    [t('propertyInfo.sectionNr'), property.SEKSJONSNR],
  ];

  const propertyRegisterUrl = `https://eiendomsregisteret.kartverket.no/eiendom/${property.KOMMUNENR}/${property.GARDSNR}/${property.BRUKSNR}/${property.FESTENR}/${property.SEKSJONSNR}`;

  return (
    <Section
      title={t('infoBox.propertyInfo')}
      open={open}
      onOpenChange={onOpenChange}
      className={className}
    >
      {addresses.length > 0 && (
        <div className={styles.addresses}>
          <span className={styles.addressLabel}>
            {t('propertyInfo.address')}
          </span>
          {addresses.map((addr, i) => (
            <span key={i} className={styles.small}>
              {addr}
            </span>
          ))}
        </div>
      )}
      {hasMultipleAddresses && (
        <p className={cx(styles.small, styles.note)}>
          {t('propertyInfo.multipleAddressesText')}
        </p>
      )}
      <div className={styles.propertyControls}>
        <Switch
          checked={showGeometry}
          onChange={setShowGeometry}
          label={t('propertyInfo.markProperty.label')}
        />
        <a
          className={styles.link}
          href={propertyRegisterUrl}
          target="_blank"
          rel="noreferrer"
        >
          {t('propertyInfo.moreInformation')}
        </a>
      </div>
      {rows.map(([label, value], index) => (
        <div
          key={label}
          className={cx(styles.tableRow, index % 2 === 0 && styles.tableRowAlt)}
        >
          <span className={styles.small}>{label}</span>
          <span className={styles.small}>{value}</span>
        </div>
      ))}
    </Section>
  );
};
